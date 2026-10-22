import { isValidPhoneNumber as isValidInternationalNumber } from "libphonenumber-js";

/** Validate canonical E.164 values before they are sent to Firebase or the API. */
export const isValidPhoneNumber = (phone: string) =>
  /^\+[1-9]\d{1,14}$/.test(phone) && isValidInternationalNumber(phone);
