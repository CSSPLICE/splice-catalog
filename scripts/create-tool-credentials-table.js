const { Client } = require("pg");

async function createToolCredentialsTable() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();

    const query = `
      CREATE TABLE IF NOT EXISTS tool_credentials (
        id SERIAL PRIMARY KEY,
        tool_id INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
        credential_key VARCHAR(100) NOT NULL,
        credential_secret TEXT NOT NULL,
        description TEXT,
      );
    `;

    await client.query(query);
  } catch (error) {
    console.error(error);
  } finally {
    await client.end();
  }
}

createToolCredentialsTable();
