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
import { JpxImage } from 'jpeg2000';

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

  // Debug: log first few fields to help diagnose field mapping
  console.log('[Aadhaar QR] Parsed fields:', textFields.slice(0, 6).map((f, i) => `[${i}]="${f.substring(0, 30)}"`).join(', '));

  // ─── DETECT V1 vs V2 FORMAT ─────────────────────────────────────────
  // UIDAI Secure QR V2 layout (based on actual QR data):
  //   field[0] = Reference ID (large number, e.g. "834720200911152733143")
  //   field[1] = Email/Mobile presence indicator (single digit: 0/1/2/3)
  //   field[2] = Name
  //   field[3] = DOB
  //   field[4] = Gender (M/F/T)
  //   field[5..15] = Address fields
  //
  // Detection strategy: check multiple heuristics
  //   - If field[1] is single digit 0-3 → V2 (indicator after refID)
  //   - If field[0] is single digit 0-3 → V2 alt (indicator before refID)  
  //   - Else → V1 (no indicator)
  //
  // Also detect by checking which field looks like a name (has letters and space)
  
  let emailMobileIndicator = 0;
  let refId = '';
  let nameIdx, dobIdx, genderIdx, coIdx, distIdx, lmIdx, houseIdx, locIdx;
  let pinIdx, poIdx, stateIdx, streetIdx, subDistIdx, vtcIdx;

  const field0 = textFields[0] || '';
  const field1 = textFields[1] || '';
  const field2 = textFields[2] || '';

  // Heuristic: a "name" field contains letters and usually a space
  const looksLikeName = (s) => /^[A-Za-z\s.'-]{2,}$/.test(s) && /[A-Za-z]/.test(s);
  // Heuristic: an "indicator" field is a single/short digit (0-9, seen values: 0,1,2,3,5)
  const looksLikeIndicator = (s) => /^\d{1,2}$/.test(s) && s.length <= 2;
  // Heuristic: a "refID" field is a long numeric string
  const looksLikeRefId = (s) => /^\d{10,}$/.test(s);

  if (looksLikeRefId(field0) && !looksLikeName(field1) && looksLikeName(field2)) {
    // V2: [refID, indicator/short-field, name, dob, gender, ...]
    refId = field0;
    emailMobileIndicator = parseInt(field1, 10) || 0;
    nameIdx = 2; dobIdx = 3; genderIdx = 4; coIdx = 5;
    distIdx = 6; lmIdx = 7; houseIdx = 8; locIdx = 9;
    pinIdx = 10; poIdx = 11; stateIdx = 12; streetIdx = 13;
    subDistIdx = 14; vtcIdx = 15;
    console.log(`[Aadhaar QR] Detected V2 format: refID="${field0.substring(0,10)}.." indicator="${field1}" name="${field2}"`);
  } else if (looksLikeIndicator(field0) && looksLikeRefId(field1) && looksLikeName(field2)) {
    // V2 alt: [indicator, refID, name, dob, gender, ...]
    emailMobileIndicator = parseInt(field0, 10);
    refId = field1;
    nameIdx = 2; dobIdx = 3; genderIdx = 4; coIdx = 5;
    distIdx = 6; lmIdx = 7; houseIdx = 8; locIdx = 9;
    pinIdx = 10; poIdx = 11; stateIdx = 12; streetIdx = 13;
    subDistIdx = 14; vtcIdx = 15;
    console.log('[Aadhaar QR] Detected V2-alt format: indicator + refID + name');
  } else if (looksLikeRefId(field0) && looksLikeName(field1)) {
    // V1: [refID, name, dob, gender, ...]
    refId = field0;
    nameIdx = 1; dobIdx = 2; genderIdx = 3; coIdx = 4;
    distIdx = 5; lmIdx = 6; houseIdx = 7; locIdx = 8;
    pinIdx = 9; poIdx = 10; stateIdx = 11; streetIdx = 12;
    subDistIdx = 13; vtcIdx = 14;
    console.log('[Aadhaar QR] Detected V1 format: refID + name');
  } else {
    // Fallback: try to find the name field by scanning
    let foundNameIdx = -1;
    for (let i = 0; i < Math.min(5, textFields.length); i++) {
      if (looksLikeName(textFields[i])) {
        foundNameIdx = i;
        break;
      }
    }
    if (foundNameIdx >= 0) {
      nameIdx = foundNameIdx;
      // Determine refID from fields before name
      refId = foundNameIdx > 0 ? textFields[0] : '';
    } else {
      nameIdx = 1; // default fallback
      refId = field0;
    }
    dobIdx = nameIdx + 1; genderIdx = nameIdx + 2; coIdx = nameIdx + 3;
    distIdx = nameIdx + 4; lmIdx = nameIdx + 5; houseIdx = nameIdx + 6;
    locIdx = nameIdx + 7; pinIdx = nameIdx + 8; poIdx = nameIdx + 9;
    stateIdx = nameIdx + 10; streetIdx = nameIdx + 11; subDistIdx = nameIdx + 12;
    vtcIdx = nameIdx + 13;
    console.log(`[Aadhaar QR] Fallback: name at field[${nameIdx}]`);
  }

  // UIDAI Secure QR Reference ID format: first 4 digits = last 4 digits of Aadhaar number
  // e.g. refId "834720260228..." → last 4 of Aadhaar = "8347"
  const refIdDigits = refId.replace(/\D/g, '');
  const uidLast4 = refIdDigits.length >= 4 ? refIdDigits.substring(0, 4) : '';
  console.log(`[Aadhaar QR] refId="${refId.substring(0,20)}.." → Aadhaar last 4="${uidLast4}"`);

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
  // V2 format has 16 fields (0-15), so last delim index = 15
  // V1 format has 15 fields (0-14), so last delim index = 14
  const lastTextDelimIdx = (nameIdx === 2) ? 15 : 14; // nameIdx=2 means V2
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
          // Detect image format from magic bytes
          const isJP2Box = (photoBytes[0] === 0x00 && photoBytes[1] === 0x00 && photoBytes[2] === 0x00);
          const isJP2Codestream = (photoBytes[0] === 0xFF && photoBytes[1] === 0x4F);
          const isJPEG = (photoBytes[0] === 0xFF && photoBytes[1] === 0xD8);
          const isPNG = (photoBytes[0] === 0x89 && photoBytes[1] === 0x50);
          
          if (isJP2Box || isJP2Codestream) {
            // ─── JPEG2000 DECODE ─────────────────────────────
            // Browsers don't support JP2 natively. Decode using jpeg2000 library
            // and render to canvas → PNG data URL
            try {
              const jpx = new JpxImage();
              jpx.parse(photoBytes);
              
              if (jpx.tiles && jpx.tiles.length > 0 && jpx.width > 0 && jpx.height > 0) {
                const tile = jpx.tiles[0];
                const canvas = document.createElement('canvas');
                canvas.width = jpx.width;
                canvas.height = jpx.height;
                const ctx = canvas.getContext('2d');
                const imgData = ctx.createImageData(jpx.width, jpx.height);
                
                // tile.items contains pixel data (RGB or RGBA)
                const pixels = tile.items;
                const components = jpx.componentsCount;
                
                for (let p = 0; p < jpx.width * jpx.height; p++) {
                  if (components >= 3) {
                    imgData.data[p * 4]     = pixels[p * components];     // R
                    imgData.data[p * 4 + 1] = pixels[p * components + 1]; // G
                    imgData.data[p * 4 + 2] = pixels[p * components + 2]; // B
                    imgData.data[p * 4 + 3] = components >= 4 ? pixels[p * components + 3] : 255; // A
                  } else {
                    // Grayscale
                    const val = pixels[p * components];
                    imgData.data[p * 4] = val;
                    imgData.data[p * 4 + 1] = val;
                    imgData.data[p * 4 + 2] = val;
                    imgData.data[p * 4 + 3] = 255;
                  }
                }
                
                ctx.putImageData(imgData, 0, 0);
                photo = canvas.toDataURL('image/png');
                console.log(`[Aadhaar QR] JP2 photo decoded: ${jpx.width}x${jpx.height}, ${components} components`);
              }
            } catch (jp2Err) {
              console.warn('[Aadhaar QR] JP2 decode failed:', jp2Err.message);
              // Fallback: store as JP2 data URL (won't display but preserves data)
              let binary = '';
              const chunkSize = 8192;
              for (let i = 0; i < photoBytes.length; i += chunkSize) {
                const chunk = photoBytes.subarray(i, Math.min(i + chunkSize, photoBytes.length));
                binary += String.fromCharCode(...chunk);
              }
              photo = `data:image/jp2;base64,${btoa(binary)}`;
            }
          } else {
            // Regular JPEG or PNG — browsers support these natively
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < photoBytes.length; i += chunkSize) {
              const chunk = photoBytes.subarray(i, Math.min(i + chunkSize, photoBytes.length));
              binary += String.fromCharCode(...chunk);
            }
            const mimeType = isPNG ? 'image/png' : 'image/jpeg';
            photo = `data:${mimeType};base64,${btoa(binary)}`;
          }
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
    uid: uidLast4, // Last 4 digits of Aadhaar (from first 4 of Reference ID)
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
      flags.push({ type: 'success', label: 'Naam Verification', message: `Aadhaar pe naam "${qrName}" aapke typed naam "${typedFullName}" se match ho gaya ✓` });
    } else if (similarity >= 0.5) {
      checks.qrVsTypedName = 'mismatch';
      flags.push({ type: 'warning', label: 'Naam Mismatch', message: `Aapka typed naam "${typedFullName}" hai lekin Aadhaar pe "${qrName}" likha hai. Spelling check karein ya sahi Aadhaar scan karein.` });
    } else {
      checks.qrVsTypedName = 'mismatch';
      flags.push({ type: 'error', label: 'Naam Match Nahi Hua', message: `Aapne naam "${typedFullName}" likha hai lekin Aadhaar card pe "${qrName}" hai. Kya aapne apna hi Aadhaar scan kiya hai?` });
    }
  } else {
    checks.qrVsTypedName = 'pending';
  }

  // 2. QR Name vs OCR Name (from Aadhaar document image)
  const ocrName = ocrData.name || '';
  const ocrConfidence = ocrData.confidence || 0;
  if (ocrName) {
    // For low OCR confidence (<70%), be very lenient — OCR text is unreliable
    if (ocrConfidence > 0 && ocrConfidence < 70) {
      checks.qrVsOcrName = 'match'; // Don't penalize for bad OCR
      flags.push({ type: 'warning', label: 'Photo Quality', message: `Aadhaar card photo thodi unclear hai (${Math.round(ocrConfidence)}% readable). Clear photo upload karein to aur achhe se verify hoga.` });
    } else {
      const similarity = stringSimilarity(qrName, ocrName);
      if (similarity >= 0.5) {
        checks.qrVsOcrName = 'match';
        flags.push({ type: 'success', label: 'Document Match', message: `Upload ki gayi Aadhaar card photo QR data se match ho gayi ✓` });
      } else if (similarity >= 0.25) {
        checks.qrVsOcrName = 'match'; // Partial match is OK
        flags.push({ type: 'warning', label: 'Document Photo Check', message: `Upload ki gayi Aadhaar photo aur QR scan me naam thoda alag dikh raha hai. Photo clear hai to koi problem nahi.` });
      } else {
        checks.qrVsOcrName = 'match'; // Even on low similarity, don't block — just warn
        flags.push({ type: 'warning', label: 'Document Check', message: `OCR se naam clearly read nahi ho paya. Document clear dikhna chahiye.` });
      }
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
        flags.push({ type: 'success', label: 'Aadhaar Number', message: `Aadhaar number verified — last 4 digits (${qrUid}) match ho gaye ✓` });
      } else {
        checks.qrVsOcrAadhaarNo = 'mismatch';
        flags.push({ type: 'error', label: 'Aadhaar Number Alag Hai', message: `QR scan me Aadhaar ke last 4 digits "${qrUid}" hain lekin upload ki gayi photo me last 4 digits "${ocrUid.slice(-4)}" hain. Same Aadhaar card ki photo upload karein.` });
      }
    } else {
      // Old QR has full 12 digits
      if (qrUid === ocrUid) {
        checks.qrVsOcrAadhaarNo = 'match';
        flags.push({ type: 'success', label: 'Aadhaar Number', message: `Aadhaar number (${maskAadhaar(qrUid)}) verified ✓` });
      } else {
        checks.qrVsOcrAadhaarNo = 'mismatch';
        flags.push({ type: 'error', label: 'Aadhaar Number Alag Hai', message: `QR scan me number ${maskAadhaar(qrUid)} hai aur photo me ${maskAadhaar(ocrUid)} hai. Dono same Aadhaar card ke hone chahiye.` });
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
  if (clean.length === 0) return '';
  if (clean.length <= 4) return 'XXXX XXXX ' + clean; // Secure QR: only last 4 digits available
  if (clean.length <= 8) return 'XXXX ' + clean.slice(-8, -4) + ' ' + clean.slice(-4);
  return clean.slice(0, 4) + ' ' + clean.slice(4, 8) + ' ' + clean.slice(-4);
};

/**
 * Format QR data for display in UI.
 */
export const formatQrDataForDisplay = (qrData) => {
  if (!qrData || !qrData.success) return null;

  return {
    name: qrData.name || 'N/A',
    aadhaarNumber: qrData.uid ? maskAadhaar(qrData.uid) : (qrData.qrType === 'secure' ? 'XXXX XXXX XXXX' : 'N/A'),
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
