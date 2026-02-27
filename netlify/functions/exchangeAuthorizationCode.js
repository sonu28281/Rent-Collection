import { exchangeAuthorizationCodeHandler } from './_kycCore.js';

export const handler = async (event) => exchangeAuthorizationCodeHandler(event);