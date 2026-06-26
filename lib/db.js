import pg from 'pg';

const { Pool } = pg;

let pool;

function getPoolConfig() {
  const host = process.env.DB_HOST;
  const port = Number(process.env.DB_PORT || 5432);
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_DATABASE;
  const schema = process.env.DB_SCHEMA || 'public';

  if (!host || !user || !password || !database) {
    throw new Error('Missing database configuration. Set DB_HOST, DB_USER, DB_PASSWORD, DB_DATABASE, and optionally DB_SCHEMA.');
  }

  return {
    host,
    port,
    user,
    password,
    database,
    schema
  };
}

export function getPool() {
  if (!pool) {
    const config = getPoolConfig();
    pool = new Pool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: {
        rejectUnauthorized: false
      }
    });
  }

  return pool;
}

export async function query(text, params = []) {
  const config = getPoolConfig();
  const client = await getPool().connect();

  try {
    await client.query(`set search_path to ${config.schema}`);
    return await client.query(text, params);
  } finally {
    client.release();
  }
}
