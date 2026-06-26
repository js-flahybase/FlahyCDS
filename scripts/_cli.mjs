function stripFlagPrefix(value) {
  return value.startsWith('--') ? value.slice(2) : value;
}

export function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;

    const normalized = stripFlagPrefix(arg);
    const equalIndex = normalized.indexOf('=');
    if (equalIndex >= 0) {
      const key = normalized.slice(0, equalIndex);
      const value = normalized.slice(equalIndex + 1);
      options[key] = value;
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith('--')) {
      options[normalized] = 'true';
      continue;
    }

    options[normalized] = nextValue;
    index += 1;
  }

  return options;
}

export function requireOption(options, key) {
  const value = String(options[key] || '').trim();
  if (!value) {
    throw new Error(`Missing required option: --${key}`);
  }
  return value;
}

export function readOptionalOption(options, key, fallback = '') {
  const value = String(options[key] || '').trim();
  return value || fallback;
}

export function exitWithError(error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
