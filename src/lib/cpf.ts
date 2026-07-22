export function normalizeCpf(value: string): string {
  return value.replace(/\D/g, '').slice(0, 11);
}

export function formatCpf(value: string): string {
  const cpf = normalizeCpf(value);

  if (cpf.length <= 3) return cpf;

  if (cpf.length <= 6) {
    return `${cpf.slice(0, 3)}.${cpf.slice(3)}`;
  }

  if (cpf.length <= 9) {
    return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6)}`;
  }

  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9, 11)}`;
}

export function maskCpf(value: string): string {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11) return '***.***.***-**';
  return `***.***.${cpf.slice(6, 9)}-${cpf.slice(9, 11)}`;
}

export function getCpfLast4(value: string): string {
  return normalizeCpf(value).slice(-4);
}

export function isValidCpf(value: string): boolean {
  const cpf = normalizeCpf(value);

  if (cpf.length !== 11) return false;

  // CPF fictício liberado apenas para teste local.
  if (process.env.NODE_ENV !== 'production' && cpf === '99999999999') {
    return true;
  }

  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split('').map(Number);

  const calcDigit = (factorStart: number) => {
    const total = digits
      .slice(0, factorStart - 1)
      .reduce((sum, digit, index) => sum + digit * (factorStart - index), 0);

    const rest = (total * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return calcDigit(10) === digits[9] && calcDigit(11) === digits[10];
}