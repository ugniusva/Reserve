(function () {
  "use strict";

  window.reservationPhoneLocalDigits = function (value, callingCode) {
    const raw = String(value || "").trim();
    const codeDigits = String(callingCode || "").replace(/\D/g, "");
    if (!raw || !codeDigits || !window.libphonenumber) return "";

    let digits = raw.replace(/\D/g, "");
    const international = raw.startsWith("+") || raw.startsWith("00");
    if (raw.startsWith("00")) digits = digits.slice(2);
    if (international && !digits.startsWith(codeDigits)) return "";

    // Let numbering-plan metadata distinguish trunk prefixes from required zeros.
    const number = window.libphonenumber.parsePhoneNumberFromString(
      "+" + (international ? digits : codeDigits + digits),
      { extract: false }
    );
    const prefix = "+" + codeDigits;
    return number?.number.startsWith(prefix) ? number.number.slice(prefix.length) : "";
  };
})();
