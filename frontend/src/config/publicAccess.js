// Backend capability confirmation is the sole frontend publication authority.
export const hasPublicReadApi = result => result?.publicReadApiEnabled === true;
