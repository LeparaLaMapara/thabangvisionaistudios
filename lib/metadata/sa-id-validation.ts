// ─── SA ID Number Validation (Luhn Checksum) ───────────────────────────────

export interface SAIDResult {
  valid: boolean;
  dateOfBirth?: string;
  gender?: string;
  citizenship?: string;
  error?: string;
}

export function validateSAID(id: string): SAIDResult {
  if (!id || id.length !== 13) {
    return { valid: false, error: 'SA ID must be exactly 13 digits' };
  }

  if (!/^\d{13}$/.test(id)) {
    return { valid: false, error: 'SA ID must contain only numbers' };
  }

  // Date of birth: YYMMDD
  const year = parseInt(id.substring(0, 2));
  const month = parseInt(id.substring(2, 4));
  const day = parseInt(id.substring(4, 6));

  if (month < 1 || month > 12)
    return { valid: false, error: 'Invalid month in ID' };
  if (day < 1 || day > 31)
    return { valid: false, error: 'Invalid day in ID' };

  // Gender: digits 7-10 (0000-4999 = female, 5000-9999 = male)
  const genderDigits = parseInt(id.substring(6, 10));
  const gender = genderDigits < 5000 ? 'female' : 'male';

  // Citizenship: digit 11 (0 = SA citizen, 1 = permanent resident)
  const citizenshipDigit = parseInt(id[10]);
  if (citizenshipDigit !== 0 && citizenshipDigit !== 1) {
    return { valid: false, error: 'Invalid citizenship digit' };
  }
  const citizenship =
    citizenshipDigit === 0 ? 'SA Citizen' : 'Permanent Resident';

  // Luhn checksum on digit 13
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let digit = parseInt(id[i]);
    if (i % 2 !== 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  if (checkDigit !== parseInt(id[12])) {
    return {
      valid: false,
      error: 'Invalid ID checksum — ID number may be fake',
    };
  }

  // Full year
  const fullYear = year >= 0 && year <= 26 ? 2000 + year : 1900 + year;
  const dateOfBirth = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { valid: true, dateOfBirth, gender, citizenship };
}
