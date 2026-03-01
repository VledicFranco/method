import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error('DATABASE_URL environment variable is required');

  const sql = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(sql);

  const migrationsFolder = join(__dirname, '..', '..', 'drizzle');
  await migrate(db, { migrationsFolder });
  await sql.end();
  console.error('Migrations complete');
}
