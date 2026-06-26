import { exitWithError, parseArgs, requireOption } from './_cli.mjs';
import { query } from './_db.mjs';

function normalizeFolderPrefix(value) {
  const trimmed = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) {
    throw new Error('Folder prefix cannot be empty');
  }
  return `${trimmed}/`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const username = requireOption(options, 'username');
  const folderPrefix = normalizeFolderPrefix(requireOption(options, 'folder'));

  const userResult = await query(
    `select id, username
     from app_users
     where username = $1
     limit 1`,
    [username]
  );

  const user = userResult.rows[0];
  if (!user) {
    throw new Error(`Unknown user: ${username}`);
  }

  const existingPermissionResult = await query(
    `select id
     from folder_permissions
     where user_id = $1 and folder_prefix = $2
     limit 1`,
    [user.id, folderPrefix]
  );

  if (existingPermissionResult.rows[0]) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          alreadyExists: true,
          permission: {
            username: user.username,
            folderPrefix
          }
        },
        null,
        2
      )
    );
    return;
  }

  await query(
    `insert into folder_permissions (user_id, folder_prefix)
     values ($1, $2)`,
    [user.id, folderPrefix]
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        permission: {
          username: user.username,
          folderPrefix
        }
      },
      null,
      2
    )
  );
}

main().catch(exitWithError);
