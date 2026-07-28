import { exitWithError, parseArgs, requireOption } from './_cli.mjs';
import { query } from './_db.mjs';
import { hashPassword } from './_password.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const username = requireOption(options, 'username');
  const password = requireOption(options, 'password');

  const existing = await query(
    `select id from app_users where username = $1 limit 1`,
    [username]
  );

  if (!existing.rows[0]) {
    throw new Error(`User not found: ${username}`);
  }

  const { salt, hash } = hashPassword(password);
  await query(
    `update app_users set password_salt = $1, password_hash = $2 where username = $3`,
    [salt, hash, username]
  );

  console.log(JSON.stringify({ ok: true, username, message: 'Password updated' }, null, 2));
}

main().catch(exitWithError);
