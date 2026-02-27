/**
 * DigiLocker Document Fetching Module
 * 
 * This module handles fetching actual documents (Aadhaar, PAN, etc.) 
 * from DigiLocker API using the access token obtained during OAuth.
 * 
 * Requirements:
 * - Scope: "openid issued_documents" (not just "openid")
 * - Valid access token from DigiLocker OAuth flow
 * - PKCE enabled (already implemented in _kycCore.js)
 */

const DIGILOCKER_API_BASE = 'https://digilocker.meripehchaan.gov.in/public/oauth2';
const DEFAULT_API_VERSION = '3';  // Try v3 first, fallback to v1 if needed

/**
 * List all issued documents for the authenticated user
 * 
 * @param {string} accessToken - DigiLocker access token
 * @param {string} apiVersion - API version ('1' or '3')
 * @returns {Promise<Array>} List of documents
 */
export async function listIssuedDocuments(accessToken, apiVersion = DEFAULT_API_VERSION) {
  const endpoints = [
    `${DIGILOCKER_API_BASE}/${apiVersion}/issued_documents`,
    `${DIGILOCKER_API_BASE}/1/issued_documents`,  // Fallback to v1
  ];
  
  let lastError = null;
  
  for (const url of endpoints) {
    try {
      console.log('📄 Fetching issued documents list from:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      
      console.log('📡 Documents list response status:', response.status);
      
      if (response.ok) {
        const documents = await response.json();
        console.log('📥 Documents retrieved:', JSON.stringify(documents, null, 2));
        return documents;
      } else {
        const errorText = await response.text();
        console.warn(`⚠️ Endpoint failed (${response.status}):`, errorText);
        lastError = new Error(`${response.status}: ${errorText}`);
      }
    } catch (error) {
      console.warn(`⚠️ Endpoint error:`, error.message);
      lastError = error;
    }
  }
  
  throw lastError || new Error('Failed to fetch documents from all endpoints');
}

/**
 * Fetch a specific document by its URI
 * 
 * @param {string} accessToken - DigiLocker access token
 * @param {string} documentUri - Document URI (e.g., "in.gov.uidai.aadhaar.12345")
 * @param {string} apiVersion - API version
 * @returns {Promise<Object>} Document content with type
 */
export async function fetchDocument(accessToken, documentUri, apiVersion = DEFAULT_API_VERSION) {
  // Encode the URI properly
  const encodedUri = encodeURIComponent(documentUri);
  const url = `${DIGILOCKER_API_BASE}/${apiVersion}/issued_documents/${encodedUri}`;
  
  console.log('📄 Fetching document from:', url);
  console.log('📄 Document URI:', documentUri);
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/xml,application/json,application/pdf'
    }
  });
  
  console.log('📡 Document fetch status:', response.status);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Failed to fetch document:', response.status, errorText);
    throw new Error(`Failed to fetch document: ${response.status} - ${errorText}`);
  }
  
  const contentType = response.headers.get('content-type') || '';
  console.log('📡 Document content-type:', contentType);
  
  if (contentType.includes('xml')) {
    const xmlText = await response.text();
    return { type: 'xml', content: xmlText, contentType };
  } else if (contentType.includes('json')) {
    const jsonData = await response.json();
    return { type: 'json', content: jsonData, contentType };
  } else if (contentType.includes('pdf')) {
    const buffer = await response.arrayBuffer();
    return { 
      type: 'pdf', 
      content: Buffer.from(buffer).toString('base64'),
      contentType 
    };
  } else {
    // Generic binary data
    const buffer = await response.arrayBuffer();
    return { 
      type: 'binary', 
      content: Buffer.from(buffer).toString('base64'),
      contentType 
    };
  }
}

/**
 * Find Aadhaar document from document list
 * 
 * @param {Array} documents - List of documents from DigiLocker
 * @returns {Object|null} Aadhaar document or null
 */
export function findAadhaarDocument(documents) {
  if (!Array.isArray(documents) || documents.length === 0) {
    console.warn('⚠️ No documents provided or empty list');
    return null;
  }
  
  console.log(`🔍 Searching for Aadhaar in ${documents.length} documents...`);
  
  // DigiLocker Aadhaar document URIs typically contain:
  // - "uidai" (UID Authority of India)
  // - "aadhaar" in name/doctype
  const aadhaarDoc = documents.find(doc => {
    const uri = String(doc.uri || '').toLowerCase();
    const doctype = String(doc.doctype || '').toLowerCase();
    const name = String(doc.name || '').toLowerCase();
    
    return uri.includes('uidai') || 
           uri.includes('aadhaar') ||
           doctype.includes('aadhaar') ||
           name.includes('aadhaar');
  });
  
  if (aadhaarDoc) {
    console.log('✅ Found Aadhaar document:', {
      name: aadhaarDoc.name,
      uri: aadhaarDoc.uri,
      doctype: aadhaarDoc.doctype
    });
  } else {
    console.warn('⚠️ No Aadhaar document found');
    console.log('📋 Available documents:', documents.map(d => ({
      name: d.name,
      doctype: d.doctype,
      uri: d.uri
    })));
  }
  
  return aadhaarDoc;
}

/**
 * Parse Aadhaar XML to extract details
 * DigiLocker returns Aadhaar as XML with structure:
 * <KycRes uid="XXXX" ...>
 *   <Poi name="..." dob="..." gender="..." />
 *   <Poa co="..." house="..." street="..." />
 * </KycRes>
 * 
 * @param {string} xmlContent - Aadhaar XML content
 * @returns {Object} Parsed Aadhaar details
 */
export function parseAadhaarXML(xmlContent) {
  console.log('🔍 Parsing Aadhaar XML...');
  
  try {
    // Extract UID (Aadhaar number) - usually masked as XXXXXXXX1234
    const uidMatch = xmlContent.match(/uid="([0-9X]{12,16})"/i);
    
    // Extract POI (Proof of Identity) attributes
    const nameMatch = xmlContent.match(/name="([^"]+)"/i);
    const dobMatch = xmlContent.match(/dob="([^"]+)"/i);
    const genderMatch = xmlContent.match(/gender="([^"]+)"/i);
    const phoneMatch = xmlContent.match(/phone="([^"]+)"/i);
    const emailMatch = xmlContent.match(/email="([^"]+)"/i);
    
    // Extract POA (Proof of Address) - multiple patterns
    const coMatch = xmlContent.match(/co="([^"]+)"/i);  // Care of
    const houseMatch = xmlContent.match(/house="([^"]+)"/i);
    const streetMatch = xmlContent.match(/street="([^"]+)"/i);
    const locMatch = xmlContent.match(/loc="([^"]+)"/i);
    const vtcMatch = xmlContent.match(/vtc="([^"]+)"/i);  // Village/Town/City
    const distMatch = xmlContent.match(/dist="([^"]+)"/i);
    const stateMatch = xmlContent.match(/state="([^"]+)"/i);
    const pcMatch = xmlContent.match(/pc="([^"]+)"/i);  // Pincode
    
    // Build address string
    const addressParts = [
      houseMatch?.[1],
      streetMatch?.[1],
      locMatch?.[1],
      vtcMatch?.[1],
      distMatch?.[1],
      stateMatch?.[1],
      pcMatch?.[1]
    ].filter(Boolean);
    
    const parsed = {
      aadhaarNumber: uidMatch ? uidMatch[1] : null,  // Masked: XXXXXXXX1234
      name: nameMatch ? nameMatch[1] : null,
      dob: dobMatch ? dobMatch[1] : null,
      gender: genderMatch ? genderMatch[1] : null,
      phone: phoneMatch ? phoneMatch[1] : null,
      email: emailMatch ? emailMatch[1] : null,
      careOf: coMatch ? coMatch[1] : null,
      address: addressParts.length > 0 ? addressParts.join(', ') : null,
      pincode: pcMatch ? pcMatch[1] : null,
      hasProofOfAddress: !!addressParts.length,
      hasProofOfIdentity: !!(nameMatch && dobMatch),
      rawXml: xmlContent  // Store full XML for reference
    };
    
    console.log('✅ Aadhaar XML parsed successfully:', {
      aadhaarNumber: parsed.aadhaarNumber,
      name: parsed.name,
      hasAddress: parsed.hasProofOfAddress,
      hasIdentity: parsed.hasProofOfIdentity
    });
    
    return parsed;
    
  } catch (error) {
    console.error('❌ Error parsing Aadhaar XML:', error);
    return {
      aadhaarNumber: null,
      name: null,
      rawXml: xmlContent,
      parseError: error.message
    };
  }
}

/**
 * Find document by type
 * 
 * @param {Array} documents - List of documents
 * @param {string} docType - Type to find (e.g., 'pan', 'driving', 'voter')
 * @returns {Object|null} Found document or null
 */
export function findDocumentByType(documents, docType) {
  if (!Array.isArray(documents)) return null;
  
  const normalizedType = docType.toLowerCase();
  
  return documents.find(doc => {
    const uri = String(doc.uri || '').toLowerCase();
    const doctype = String(doc.doctype || '').toLowerCase();
    const name = String(doc.name || '').toLowerCase();
    
    return uri.includes(normalizedType) || 
           doctype.includes(normalizedType) ||
           name.includes(normalizedType);
  });
}

/**
 * Get document summary for logging
 * 
 * @param {Array} documents - List of documents
 * @returns {Array} Summary array
 */
export function getDocumentsSummary(documents) {
  if (!Array.isArray(documents)) return [];
  
  return documents.map(doc => ({
    name: doc.name || 'Unknown',
    type: doc.doctype || 'Unknown',
    uri: doc.uri || 'No URI',
    issuer: doc.issuer || 'Unknown Issuer',
    issueDate: doc.issueDate || null
  }));
}

export default {
  listIssuedDocuments,
  fetchDocument,
  findAadhaarDocument,
  parseAadhaarXML,
  findDocumentByType,
  getDocumentsSummary
};
