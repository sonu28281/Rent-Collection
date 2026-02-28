/**
 * Aadhaar QR Code Parser & Cross-Verification Utility
 * 
 * Handles two types of Aadhaar QR codes:
 * 1. Old XML-based QR (pre-2018) - Contains XML with full Aadhaar number
 * 2. Secure QR (post-2018) - Contains compressed binary data with last 4 digits
 * 
 * Also provides cross-verification between QR data, OCR data, and typed data.
 */

import pako from 'pako';

// ─── XML QR PARSER (Pre-2018 Aadhaar Cards) ────────────────────────────────

/**
 * Parse XML-based Aadhaar QR code data.
 * Format: <PrintLetterBarcodeData uid="..." name="..." gender="..." yob="..." .../>
 * 
 * @param {string} xmlString - Raw XML string from QR code
 * @returns {object} Parsed Aadhaar data
 */
export const parseXmlQr = (xmlString) => {
  try {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlString.trim(), 'text/xml');
    
    // Check for parse errors
    const parseError = xml.querySelector('parsererror');
    if (parseError) {
      throw new Error('Invalid XML format in QR code');
    }

    const root = xml.documentElement;
    
    // Support both PrintLetterBarcodeData and other root elements
    const getName = (attr) => root.getAttribute(attr) || '';

    const address = {
      co: getName('co'),
      house: getName('house'),
      street: getName('street'),
      landmark: getName('lm'),
      locality: getName('loc'),
      vtc: getName('vtc'),
      district: getName('dist'),
      state: getName('state'),
      pincode: getName('pc'),
    };

    // Build full address string
    const addressParts = [
      address.co ? `C/O ${address.co}` : '',
      address.house,
      address.street,
      address.landmark,
      address.locality,
      address.vtc,
      address.district,
      address.state,
      address.pincode,
    ].filter(Boolean);

    return {
      success: true,
      qrType: 'xml',
      name: getName('name'),
      uid: getName('uid'), // Full 12-digit Aadhaar number
      dob: getName('dob') || getName('yob'), // DOB or Year of Birth
      gender: getName('gender'),
      address: address,
      fullAddress: addressParts.join(', '),
      photo: null, // Not available in XML QR
      rawData: xmlString,
      scannedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      success: false,
      error: `XML QR Parse Error: ${error.message}`,
      rawData: xmlString,
    };
  }
};


// ─── SECURE QR PARSER (Post-2018 Aadhaar Cards) ────────────────────────────

/**
 * Parse Secure QR code data from Aadhaar card.
 * 
 * Secure QR data flow:
 * 1. QR contains a large numeric string (big integer)
 * 2. Convert to byte array
 * 3. Decompress with zlib (pako)
 * 4. Parse delimiter-separated fields
 * 
 * @param {string|Uint8Array} rawData - Raw QR data (numeric string or bytes)
 * @returns {object} Parsed Aadhaar data
 */
export const parseSecureQr = (rawData) => {
  try {
    let decompressedBytes;
    
    if (typeof rawData === 'string') {
      // Check if it's a numeric string (big integer representation)
      if (/^\d+$/.test(rawData.trim())) {
        const byteArray = bigIntToByteArray(rawData.trim());
        decompressedBytes = decompressDataToBytes(byteArray);
      } else {
        // Try direct decompression (might be base64 or raw bytes as string)
        try {
          // Try base64 decode first
          const binaryString = atob(rawData);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          decompressedBytes = decompressDataToBytes(bytes);
        } catch {
          // Try as raw string bytes
          const encoder = new TextEncoder();
          const bytes = encoder.encode(rawData);
          decompressedBytes = decompressDataToBytes(bytes);
        }
      }
    } else if (rawData instanceof Uint8Array) {
      decompressedBytes = decompressDataToBytes(rawData);
    } else {
      throw new Error('Unsupported QR data format');
    }

    // Parse the decompressed bytes (not string)
    return parseDecompressedSecureQrBytes(decompressedBytes, rawData);
  } catch (error) {
    return {
      success: false,
      error: `Secure QR Parse Error: ${error.message}`,
      rawData: typeof rawData === 'string' ? rawData.substring(0, 200) : '[binary data]',
    };
  }
};

/**
 * Convert big integer string to byte array.
 * Aadhaar Secure QR stores data as a large decimal number.
 */
function bigIntToByteArray(bigIntStr) {
  // Use BigInt for precision
  let num = BigInt(bigIntStr);
  const bytes = [];
  
  while (num > 0n) {
    bytes.unshift(Number(num & 0xFFn));
    num >>= 8n;
  }
  
  return new Uint8Array(bytes);
}

/**
 * Decompress zlib-compressed data using pako — returns raw Uint8Array.
 * IMPORTANT: We must NOT convert to string here because the data contains
 * binary photo bytes and 0xFF delimiters that get corrupted in string form.
 */
function decompressDataToBytes(byteArray) {
  try {
    // Try raw inflate first (no header) — returns Uint8Array
    return pako.inflateRaw(byteArray);
  } catch {
    try {
      // Try with zlib header
      return pako.inflate(byteArray);
    } catch {
      // Return as-is (maybe not compressed)
      return byteArray;
    }
  }
}

// Legacy wrapper (kept for backward compatibility)
function decompressData(byteArray) {
  const bytes = decompressDataToBytes(byteArray);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(bytes);
}

/**
 * Split a Uint8Array on a given byte delimiter.
 * Returns array of Uint8Array segments.
 */
function splitBytes(byteArray, delimiter) {
  const segments = [];
  let start = 0;
  for (let i = 0; i < byteArray.length; i++) {
    if (byteArray[i] === delimiter) {
      segments.push(byteArray.slice(start, i));
      start = i + 1;
    }
  }
  // Push remaining bytes (last field, often the photo)
  if (start < byteArray.length) {
    segments.push(byteArray.slice(start));
  }
  return segments;
}

/**
 * Parse decompressed Secure QR byte data.
 * 
 * UIDAI Secure QR v2 format:
 * - Fields are separated by byte 0xFF
 * - First 15 fields are text (UTF-8), field 16+ is photo (JPEG2000 binary)
 * - The photo data MUST NOT be decoded as text — it contains JJ2000 headers
 *   and binary image data that corrupts the address/other fields when mixed.
 * 
 * Secure QR v2 field order:
 * [0] Reference ID (last 4 digits of Aadhaar)
 * [1] Name
 * [2] Date of Birth (DD-MM-YYYY or DD/MM/YYYY)
 * [3] Gender (M/F/T)
 * [4] Care Of (S/O, D/O, W/O)
 * [5] District
 * [6] Landmark
 * [7] House
 * [8] Location
 * [9] Pin Code
 * [10] Post Office
 * [11] State
 * [12] Street
 * [13] Sub District
 * [14] VTC (Village/Town/City)
 * [15..] Signature + Photo (binary)
 */
function parseDecompressedSecureQrBytes(decompressedBytes, originalRaw) {
  const textDecoder = new TextDecoder('utf-8', { fatal: false });
  
  // Split on 0xFF delimiter at byte level
  const segments = splitBytes(decompressedBytes, 0xFF);
  
  // Also try other delimiters if 0xFF didn't produce enough fields
  let fields = segments;
  if (fields.length < 8) {
    const altDelimiters = [0x00, 0x0A, 0x09, 0x1E, 0x1C]; // null, newline, tab, RS, FS
    for (const delim of altDelimiters) {
      const parts = splitBytes(decompressedBytes, delim);
      if (parts.length >= 8) {
        fields = parts;
        break;
      }
    }
  }

  // Decode text fields (only first 15 fields — rest is binary photo/signature)
  const TEXT_FIELD_COUNT = 15;
  const textFields = [];
  for (let i = 0; i < Math.min(fields.length, TEXT_FIELD_COUNT); i++) {
    textFields.push(textDecoder.decode(fields[i]).trim());
  }

  // If we still don't have enough text fields, try regex-based fallback on text portion only
  if (textFields.length < 8) {
    // Decode only possible text portion (first ~500 bytes to avoid photo data)
    const textPortion = textDecoder.decode(decompressedBytes.slice(0, Math.min(500, decompressedBytes.length)));
    const nameMatch = textPortion.match(/([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)+)/);
    const dobMatch = textPortion.match(/(\d{2}[-/]\d{2}[-/]\d{4})/);
    const genderMatch = textPortion.match(/\b([MFT])\b/);
    const pinMatch = textPortion.match(/\b(\d{6})\b/);
    const last4Match = textPortion.match(/^(\d{4})/);

    return {
      success: true,
      qrType: 'secure',
      name: nameMatch ? nameMatch[1] : '',
      uid: last4Match ? last4Match[1] : '',
      dob: dobMatch ? dobMatch[1] : '',
      gender: genderMatch ? genderMatch[1] : '',
      address: {
        co: '', house: '', street: '', landmark: '',
        locality: '', vtc: '', district: '', state: '',
        pincode: pinMatch ? pinMatch[1] : '',
      },
      fullAddress: '',
      photo: null,
      rawData: typeof originalRaw === 'string' ? originalRaw.substring(0, 200) : '[binary]',
      scannedAt: new Date().toISOString(),
      parseNote: 'Partial parse — delimiter not detected. Data might need manual verification.',
    };
  }

  // Build structured data from text fields
  const address = {
    co: textFields[4] || '',
    house: textFields[7] || '',
    street: textFields[12] || '',
    landmark: textFields[6] || '',
    locality: textFields[8] || '',
    vtc: textFields[14] || '',
    district: textFields[5] || '',
    state: textFields[11] || '',
    pincode: textFields[9] || '',
  };

  const addressParts = [
    address.co ? `C/O ${address.co}` : '',
    address.house,
    address.street,
    address.landmark,
    address.locality,
    address.vtc,
    address.district,
    address.state,
    address.pincode,
  ].filter(Boolean);

  // Extract photo if available (field index 15+)
  let photo = null;
  if (fields.length > 15) {
    try {
      // Concatenate all remaining binary segments as photo data
      const photoSegments = fields.slice(15);
      let totalLen = photoSegments.reduce((sum, seg) => sum + seg.length, 0) + (photoSegments.length - 1);
      const photoBytes = new Uint8Array(totalLen);
      let offset = 0;
      for (let i = 0; i < photoSegments.length; i++) {
        if (i > 0) {
          photoBytes[offset++] = 0xFF; // Re-insert delimiters within photo data
        }
        photoBytes.set(photoSegments[i], offset);
        offset += photoSegments[i].length;
      }
      const photoBase64 = btoa(String.fromCharCode(...photoBytes));
      if (photoBase64.length > 100) {
        photo = `data:image/jpeg;base64,${photoBase64}`;
      }
    } catch {
      // Photo extraction failed — non-critical
    }
  }

  return {
    success: true,
    qrType: 'secure',
    name: textFields[1] || '',
    uid: textFields[0] || '', // Last 4 digits of Aadhaar (Reference ID)
    dob: textFields[2] || '',
    gender: textFields[3] || '',
    address,
    fullAddress: addressParts.join(', '),
    photo,
    rawData: typeof originalRaw === 'string' ? originalRaw.substring(0, 200) : '[binary]',
    scannedAt: new Date().toISOString(),
  };
}


// ─── AUTO-DETECT & PARSE ────────────────────────────────────────────────────

/**
 * Auto-detect QR type and parse accordingly.
 * @param {string} qrData - Raw QR data string
 * @returns {object} Parsed Aadhaar data
 */
export const parseAadhaarQr = (qrData) => {
  if (!qrData || typeof qrData !== 'string') {
    return { success: false, error: 'No QR data provided' };
  }

  const trimmed = qrData.trim();

  // Check if it's XML (starts with < or contains PrintLetterBarcodeData)
  if (trimmed.startsWith('<') || trimmed.includes('PrintLetterBarcodeData')) {
    return parseXmlQr(trimmed);
  }

  // Check if it's a large numeric string (Secure QR)
  if (/^\d{50,}$/.test(trimmed)) {
    return parseSecureQr(trimmed);
  }

  // Try generic parsing — might be encoded differently
  // Some mAadhaar apps output differently formatted QR
  if (trimmed.length > 100) {
    return parseSecureQr(trimmed);
  }

  return {
    success: false,
    error: 'QR code does not appear to be an Aadhaar QR code. Please scan the QR code on your physical Aadhaar card or mAadhaar app.',
    rawData: trimmed.substring(0, 100),
  };
};


// ─── CROSS-VERIFICATION ─────────────────────────────────────────────────────

/**
 * Normalize a name string for comparison.
 * Removes extra spaces, converts to lowercase, removes common prefixes.
 */
function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(mr|mrs|ms|shri|smt|dr|prof)\.?\s+/i, '');
}

/**
 * Calculate similarity between two strings (Levenshtein-based).
 * Returns a value between 0 (completely different) and 1 (identical).
 */
function stringSimilarity(str1, str2) {
  const s1 = normalizeName(str1);
  const s2 = normalizeName(str2);
  
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  // Token-based matching (handles word reordering)
  const tokens1 = s1.split(' ').filter(Boolean);
  const tokens2 = s2.split(' ').filter(Boolean);
  
  let matchedTokens = 0;
  const totalTokens = Math.max(tokens1.length, tokens2.length);
  
  for (const t1 of tokens1) {
    for (const t2 of tokens2) {
      if (t1 === t2 || levenshteinSimilarity(t1, t2) > 0.8) {
        matchedTokens++;
        break;
      }
    }
  }

  return totalTokens > 0 ? matchedTokens / totalTokens : 0;
}

/**
 * Levenshtein distance based similarity.
 */
function levenshteinSimilarity(a, b) {
  if (a.length === 0) return b.length === 0 ? 1 : 0;
  if (b.length === 0) return 0;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const maxLen = Math.max(a.length, b.length);
  return 1 - matrix[b.length][a.length] / maxLen;
}

/**
 * Normalize Aadhaar number for comparison.
 * Removes spaces, dashes, and keeps only digits.
 */
function normalizeAadhaarNumber(num) {
  if (!num) return '';
  return num.replace(/[\s\-]/g, '');
}

/**
 * Cross-verify QR data against OCR data and user-typed data.
 * 
 * @param {object} qrData - Parsed QR data (from parseAadhaarQr)
 * @param {object} ocrData - OCR extracted data { name, aadhaarNumber }
 * @param {object} typedData - User typed data { firstName, lastName, fullName }
 * @returns {object} Verification result with status and flags
 */
export const crossVerify = (qrData, ocrData = {}, typedData = {}) => {
  const flags = [];
  const checks = {};

  if (!qrData || !qrData.success) {
    return {
      overallStatus: 'pending',
      qrVsTypedName: 'pending',
      qrVsOcrName: 'pending',
      qrVsOcrAadhaarNo: 'pending',
      qrVsSelfie: 'skipped',
      flags: ['QR data not available'],
      checks: {},
    };
  }

  const qrName = qrData.name || '';

  // 1. QR Name vs Typed Name
  const typedFullName = typedData.fullName || 
    `${typedData.firstName || ''} ${typedData.lastName || ''}`.trim();
  
  if (typedFullName) {
    const similarity = stringSimilarity(qrName, typedFullName);
    if (similarity >= 0.8) {
      checks.qrVsTypedName = 'match';
    } else if (similarity >= 0.5) {
      checks.qrVsTypedName = 'mismatch';
      flags.push(`⚠️ QR name "${qrName}" partially matches typed name "${typedFullName}" (${Math.round(similarity * 100)}% match)`);
    } else {
      checks.qrVsTypedName = 'mismatch';
      flags.push(`❌ QR name "${qrName}" does NOT match typed name "${typedFullName}" (${Math.round(similarity * 100)}% match)`);
    }
  } else {
    checks.qrVsTypedName = 'pending';
  }

  // 2. QR Name vs OCR Name (from Aadhaar document image)
  const ocrName = ocrData.name || '';
  if (ocrName) {
    const similarity = stringSimilarity(qrName, ocrName);
    if (similarity >= 0.7) {
      checks.qrVsOcrName = 'match';
    } else if (similarity >= 0.4) {
      checks.qrVsOcrName = 'mismatch';
      flags.push(`⚠️ QR name "${qrName}" partially matches OCR name "${ocrName}" (${Math.round(similarity * 100)}% match)`);
    } else {
      checks.qrVsOcrName = 'mismatch';
      flags.push(`❌ QR name "${qrName}" does NOT match document OCR name "${ocrName}" — possible fake document`);
    }
  } else {
    checks.qrVsOcrName = 'pending';
  }

  // 3. QR Aadhaar No. vs OCR Aadhaar No.
  const qrUid = normalizeAadhaarNumber(qrData.uid);
  const ocrUid = normalizeAadhaarNumber(ocrData.aadhaarNumber);
  
  if (qrUid && ocrUid) {
    if (qrUid.length === 4) {
      // Secure QR only has last 4 digits
      if (ocrUid.endsWith(qrUid)) {
        checks.qrVsOcrAadhaarNo = 'match';
      } else {
        checks.qrVsOcrAadhaarNo = 'mismatch';
        flags.push(`❌ QR Aadhaar last 4 digits (${qrUid}) do NOT match OCR number ending (${ocrUid.slice(-4)}) — REJECTED`);
      }
    } else {
      // Old QR has full 12 digits
      if (qrUid === ocrUid) {
        checks.qrVsOcrAadhaarNo = 'match';
      } else {
        checks.qrVsOcrAadhaarNo = 'mismatch';
        flags.push(`❌ QR Aadhaar number (${maskAadhaar(qrUid)}) does NOT match OCR number (${maskAadhaar(ocrUid)}) — REJECTED`);
      }
    }
  } else {
    checks.qrVsOcrAadhaarNo = 'pending';
  }

  // 4. Selfie vs QR Photo (placeholder — visual comparison is complex)
  checks.qrVsSelfie = 'skipped';

  // Determine overall status
  const checkValues = Object.values(checks).filter(v => v !== 'pending' && v !== 'skipped');
  const hasRejection = flags.some(f => f.includes('REJECTED'));
  const hasMismatch = checkValues.includes('mismatch');
  const allMatch = checkValues.length > 0 && checkValues.every(v => v === 'match');

  let overallStatus;
  if (hasRejection) {
    overallStatus = 'rejected';
  } else if (hasMismatch) {
    overallStatus = 'flagged';
  } else if (allMatch) {
    overallStatus = 'verified'; 
  } else {
    overallStatus = 'pending';
  }

  return {
    overallStatus,
    ...checks,
    flags,
  };
};


// ─── HELPER FUNCTIONS ───────────────────────────────────────────────────────

/**
 * Mask Aadhaar number for display: XXXX XXXX 1234
 */
export const maskAadhaar = (uid) => {
  if (!uid) return '';
  const clean = uid.replace(/\D/g, '');
  if (clean.length <= 4) return clean;
  return 'XXXX XXXX ' + clean.slice(-4);
};

/**
 * Format QR data for display in UI.
 */
export const formatQrDataForDisplay = (qrData) => {
  if (!qrData || !qrData.success) return null;

  return {
    name: qrData.name || 'N/A',
    aadhaarNumber: maskAadhaar(qrData.uid),
    dob: qrData.dob || 'N/A',
    gender: qrData.gender === 'M' ? 'Male' : qrData.gender === 'F' ? 'Female' : qrData.gender === 'T' ? 'Transgender' : qrData.gender || 'N/A',
    address: qrData.fullAddress || 'N/A',
    photo: qrData.photo || null,
    qrType: qrData.qrType === 'xml' ? 'Standard QR' : 'Secure QR (UIDAI Signed)',
    scannedAt: qrData.scannedAt ? new Date(qrData.scannedAt).toLocaleString('en-IN') : '',
    hasWarning: !!qrData.parseNote,
    warning: qrData.parseNote || '',
  };
};
