import { initiateKycHandler } from './_kycCore.js';

export const handler = async (event) => initiateKycHandler(event);