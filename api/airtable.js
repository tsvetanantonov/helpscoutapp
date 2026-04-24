import Airtable from 'airtable';

const {
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  TABLE_CUSTOMERS,
  AIRTABLE_CUSTOMERS_EMAIL_FIELD = 'Email',
} = process.env;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  const email = normalizeEmail(req.query.email);
  if (!email) {
    return sendJson(res, 400, { error: 'Missing email query parameter' });
  }

  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID || !TABLE_CUSTOMERS) {
    return sendJson(res, 500, { error: 'Airtable environment variables are not configured' });
  }

  try {
    const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);
    const records = await base(TABLE_CUSTOMERS)
      .select({
        maxRecords: 3,
        filterByFormula: `LOWER({${AIRTABLE_CUSTOMERS_EMAIL_FIELD}}) = '${escapeFormulaString(email)}'`,
      })
      .firstPage();

    return sendJson(res, 200, {
      email,
      records: records.map((record) => ({
        id: record.id,
        fields: record.fields,
      })),
    });
  } catch (error) {
    console.error('Airtable lookup failed', error);
    return sendJson(res, 500, {
      error: 'Airtable lookup failed',
      details: getErrorMessage(error),
    });
  }
}

function sendJson(res, statusCode, body) {
  if (typeof res.status === 'function') {
    return res.status(statusCode).json(body);
  }

  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function normalizeEmail(value) {
  if (Array.isArray(value)) return normalizeEmail(value[0]);
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function escapeFormulaString(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function getErrorMessage(error) {
  if (!error) return 'Unknown error';
  if (typeof error.message === 'string') return error.message;
  if (typeof error.error === 'string') return error.error;
  return 'Unknown error';
}
