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
 * Find positions of a delimiter byte in a Uint8Array.
 * Returns array of indices where the delimiter occurs.
 */
function findDelimiterPositions(byteArray, delimiter) {
  const positions = [];
  for (let i = 0; i < byteArray.length; i++) {
    if (byteArray[i] === delimiter) {
      positions.push(i);
    }
  }
  return positions;
}

/**
 * Parse decompressed Secure QR byte data.
 * 
 * UIDAI Secure QR V2 format (after decompression):
 * Fields are separated by 0xFF byte delimiter.
 * 
 * Field order (0-indexed):
 * [0]  Email/Mobile presence indicator (0=none, 1=email, 2=mobile, 3=both)
 * [1]  Reference ID (last 4 digits of Aadhaar + timestamp)
 * [2]  Name
 * [3]  Date of Birth (DD-MM-YYYY or DD/MM/YYYY)
 * [4]  Gender (M/F/T)
 * [5]  Care Of (C/O, S/O, D/O, W/O)
 * [6]  District
 * [7]  Landmark
 * [8]  House
 * [9]  Location
 * [10] Pin Code
 * [11] Post Office
 * [12] State
 * [13] Street
 * [14] Sub District
 * [15] VTC (Village/Town/City)
 * 
 * After VTC (depending on indicator):
 *   If indicator has email (1 or 3): next field = email
 *   If indicator has mobile (2 or 3): next field = mobile
 * Then: 256 bytes digital signature
 * Then: Photo bytes (JPEG2000 format — NOT regular JPEG)
 * 
 * IMPORTANT: We must NOT split on 0xFF beyond the text fields, because
 * the signature and photo contain 0xFF bytes naturally.
 */
function parseDecompressedSecureQrBytes(decompressedBytes, originalRaw) {
  const textDecoder = new TextDecoder('utf-8', { fatal: false });
  
  // Find all 0xFF positions
  let delimPositions = findDelimiterPositions(decompressedBytes, 0xFF);
  let delimByte = 0xFF;

  // If 0xFF didn't produce enough fields, try alternatives
  if (delimPositions.length < 10) {
    const altDelimiters = [0x00, 0x0A, 0x09, 0x1E, 0x1C];
    for (const delim of altDelimiters) {
      const positions = findDelimiterPositions(decompressedBytes, delim);
      if (positions.length >= 10) {
        delimPositions = positions;
        delimByte = delim;
        break;
      }
    }
  }

  // We need at least 16 text fields (indices 0-15)
  // That means at least 15 delimiters between them
  const TEXT_FIELD_COUNT = 16;

  if (delimPositions.length < TEXT_FIELD_COUNT - 1) {
    // Fallback: try regex on the first ~500 bytes
    const textPortion = textDecoder.decode(decompressedBytes.slice(0, Math.min(500, decompressedBytes.length)));
    const nameMatch = textPortion.match(/([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)+)/);
    const dobMatch = textPortion.match(/(\d{2}[-/]\d{2}[-/]\d{4})/);
    const genderMatch = textPortion.match(/\b([MFT])\b/);
    const pinMatch = textPortion.match(/\b(\d{6})\b/);
    const last4Match = textPortion.match(/\b(\d{4})\b/);

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

  // Extract only the first TEXT_FIELD_COUNT fields as text
  // DO NOT split beyond that — rest is binary (signature + photo)
  const textFields = [];
  let fieldStart = 0;
  for (let i = 0; i < TEXT_FIELD_COUNT && i <= delimPositions.length; i++) {
    const fieldEnd = i < delimPositions.length ? delimPositions[i] : decompressedBytes.length;
    const fieldBytes = decompressedBytes.slice(fieldStart, fieldEnd);
    textFields.push(textDecoder.decode(fieldBytes).trim());
    fieldStart = fieldEnd + 1; // skip delimiter
  }

  // ─── DETECT V1 vs V2 FORMAT ─────────────────────────────────────────
  // UIDAI Secure QR V2 layout (based on actual QR data):
  //   field[0] = Reference ID (large number, e.g. "834720200911152733143")
  //   field[1] = Email/Mobile presence indicator (single digit: 0/1/2/3)
  //   field[2] = Name
  //   field[3] = DOB
  //   field[4] = Gender
  //   field[5..15] = Address fields
  //
  // V1 layout:
  //   field[0] = Reference ID
  //   field[1] = Name
  //   field[2] = DOB
  //   ...
  //
  // Detection: if field[1] is a single digit 0-3, it's V2
  
  let emailMobileIndicator = 0;
  let refId = textFields[0] || '';
  let nameIdx, dobIdx, genderIdx, coIdx, distIdx, lmIdx, houseIdx, locIdx;
  let pinIdx, poIdx, stateIdx, streetIdx, subDistIdx, vtcIdx;

  const field1 = textFields[1] || '';
  const isV2 = /^[0-3]$/.test(field1);

  if (isV2) {
    // V2 format: field[0] = refId, field[1] = indicator, field[2..] = data
    emailMobileIndicator = parseInt(field1, 10);
    nameIdx = 2; dobIdx = 3; genderIdx = 4; coIdx = 5;
    distIdx = 6; lmIdx = 7; houseIdx = 8; locIdx = 9;
    pinIdx = 10; poIdx = 11; stateIdx = 12; streetIdx = 13;
    subDistIdx = 14; vtcIdx = 15;
  } else {
    // V1 format: field[0] = refId, field[1] = name, field[2..] = data
    nameIdx = 1; dobIdx = 2; genderIdx = 3; coIdx = 4;
    distIdx = 5; lmIdx = 6; houseIdx = 7; locIdx = 8;
    pinIdx = 9; poIdx = 10; stateIdx = 11; streetIdx = 12;
    subDistIdx = 13; vtcIdx = 14;
  }

  // Extract UID (last 4 digits of Aadhaar from reference ID)
  const uidLast4 = refId.replace(/\D/g, '').substring(0, 4);

  // Build address
  const address = {
    co: textFields[coIdx] || '',
    house: textFields[houseIdx] || '',
    street: textFields[streetIdx] || '',
    landmark: textFields[lmIdx] || '',
    locality: textFields[locIdx] || '',
    vtc: textFields[vtcIdx] || '',
    district: textFields[distIdx] || '',
    state: textFields[stateIdx] || '',
    pincode: textFields[pinIdx] || '',
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

  // ─── EXTRACT PHOTO ────────────────────────────────────────────────────
  // After the last text field, determine how many extra fields (email/mobile)
  // then 256 bytes signature, then remaining = photo
  let photo = null;

  // Position after last text field delimiter
  const lastTextDelimIdx = isV2 ? 15 : 14; // index in delimPositions
  if (delimPositions.length > lastTextDelimIdx) {
    try {
      const binaryStart = delimPositions[lastTextDelimIdx] + 1;
      
      // Skip VTC field content — find end of VTC
      let tailStart = binaryStart;
      // VTC ends at the next delimiter or we need to skip its content
      // Actually tailStart already points after VTC delimiter
      // We need to skip email/mobile fields if present
      let extraFieldsCount = 0;
      if (emailMobileIndicator === 1 || emailMobileIndicator === 2) extraFieldsCount = 1;
      if (emailMobileIndicator === 3) extraFieldsCount = 2;
      
      // Skip extra email/mobile fields (find their delimiters)
      let skipStart = tailStart;
      // First, skip the VTC field content
      if (lastTextDelimIdx + 1 < delimPositions.length) {
        skipStart = delimPositions[lastTextDelimIdx + 1] + 1; // after VTC content
      }
      // Skip email/mobile fields
      for (let e = 0; e < extraFieldsCount; e++) {
        // Find next delimiter after current position
        const nextDelim = delimPositions.find(p => p > skipStart);
        if (nextDelim !== undefined) {
          skipStart = nextDelim + 1;
        }
      }

      // Remaining bytes: 256 bytes signature + photo
      const remainingBytes = decompressedBytes.slice(skipStart);
      
      if (remainingBytes.length > 256) {
        const SIGNATURE_LEN = 256;
        const photoBytes = remainingBytes.slice(SIGNATURE_LEN);
        
        if (photoBytes.length > 100) {
          // Convert to base64 - use chunked approach for large arrays
          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < photoBytes.length; i += chunkSize) {
            const chunk = photoBytes.subarray(i, Math.min(i + chunkSize, photoBytes.length));
            binary += String.fromCharCode(...chunk);
          }
          const photoBase64 = btoa(binary);
          
          // Detect image format from magic bytes
          // JPEG: FF D8 FF | JPEG2000: 00 00 00 0C 6A 50 or FF 4F FF 51 | PNG: 89 50 4E 47
          let mimeType = 'image/jpeg'; // default
          if (photoBytes[0] === 0x00 && photoBytes[1] === 0x00 && photoBytes[2] === 0x00) {
            mimeType = 'image/jp2'; // JPEG2000
          } else if (photoBytes[0] === 0xFF && photoBytes[1] === 0x4F) {
            mimeType = 'image/jp2'; // JPEG2000 codestream
          } else if (photoBytes[0] === 0x89 && photoBytes[1] === 0x50) {
            mimeType = 'image/png';
          }
          
          photo = `data:${mimeType};base64,${photoBase64}`;
        }
      }
    } catch {
      // Photo extraction failed — non-critical
    }
  }

  return {
    success: true,
    qrType: 'secure',
    name: textFields[nameIdx] || '',
    uid: uidLast4, // Last 4 digits of Aadhaar (from Reference ID)
    dob: textFields[dobIdx] || '',
    gender: textFields[genderIdx] || '',
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
      flags.push(`⚠️ Aadhaar QR pe naam "${qrName}" aapke typed naam "${typedFullName}" se thoda alag hai. Please check spelling.`);
    } else {
      checks.qrVsTypedName = 'mismatch';
      flags.push(`⚠️ Aadhaar QR pe naam aapke typed naam se match nahi ho raha. Sahi Aadhaar scan kiya hai? Please re-check.`);
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
      flags.push(`⚠️ QR aur document image pe naam thoda alag hai. Ye OCR reading ke kaaran ho sakta hai.`);
    } else {
      checks.qrVsOcrName = 'mismatch';
      flags.push(`⚠️ QR aur document image pe naam match nahi ho raha. Sahi document upload kiya hai? Please re-check.`);
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
        flags.push(`❌ Aadhaar number match nahi ho raha. QR ke last 4 digits (${qrUid}) document se alag hain (${ocrUid.slice(-4)}). Please sahi Aadhaar card upload karein.`);
      }
    } else {
      // Old QR has full 12 digits
      if (qrUid === ocrUid) {
        checks.qrVsOcrAadhaarNo = 'match';
      } else {
        checks.qrVsOcrAadhaarNo = 'mismatch';
        flags.push(`❌ Aadhaar number match nahi ho raha. QR (${maskAadhaar(qrUid)}) aur document (${maskAadhaar(ocrUid)}) me alag number hai. Sahi document upload karein.`);
      }
    }
  } else {
    checks.qrVsOcrAadhaarNo = 'pending';
  }

  // 4. Selfie vs QR Photo (placeholder — visual comparison is complex)
  checks.qrVsSelfie = 'skipped';

  // Determine overall status
  const checkValues = Object.values(checks).filter(v => v !== 'pending' && v !== 'skipped');
  const hasAadhaarMismatch = checks.qrVsOcrAadhaarNo === 'mismatch';
  const hasMismatch = checkValues.includes('mismatch');
  const allMatch = checkValues.length > 0 && checkValues.every(v => v === 'match');

  let overallStatus;
  if (hasAadhaarMismatch) {
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
