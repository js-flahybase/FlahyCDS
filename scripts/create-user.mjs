import { exitWithError, parseArgs, readOptionalOption, requireOption } from './_cli.mjs';
import { query } from './_db.mjs';
import { hashPassword } from './_password.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const username = requireOption(options, 'username');
  const password = requireOption(options, 'password');
  const userType = readOptionalOption(options, 'user-type', 'lab_user');
  const isActive = readOptionalOption(options, 'active', 'true').toLowerCase() !== 'false';

  const existingUserResult = await query(
    `select id
     from app_users
     where username = $1
     limit 1`,
    [username]
  );

  if (existingUserResult.rows[0]) {
    throw new Error(`User already exists: ${username}`);
  }

  const userTypeResult = await query(
    `select id, code
     from user_types
     where code = $1
     limit 1`,
    [userType]
  );

  const matchedUserType = userTypeResult.rows[0];
  if (!matchedUserType) {
    throw new Error(`Unknown user type: ${userType}`);
  }

  const { salt, hash } = hashPassword(password);
  const insertResult = await query(
    `insert into app_users (username, password_salt, password_hash, user_type_id, is_active)
     values ($1, $2, $3, $4, $5)
     returning id, username, is_active`,
    [username, salt, hash, matchedUserType.id, isActive]
  );

  const createdUser = insertResult.rows[0];
  console.log(
    JSON.stringify(
      {
        ok: true,
        user: {
          id: createdUser.id,
          username: createdUser.username,
          userType: matchedUserType.code,
          isActive: createdUser.is_active
        }
      },
      null,
      2
    )
  );
}

main().catch(exitWithError);
