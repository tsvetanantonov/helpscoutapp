import Airtable from 'airtable';

const {
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  TABLE_CUSTOMERS,
  TABLE_BOOKINGS,
  TABLE_TRIPS,
  TABLE_BOOKING_CRM,
  TABLE_LEADS,
  AIRTABLE_CUSTOMERS_EMAIL_FIELD = 'Client Email',
} = process.env;

const OPEN_LEAD_STATUSES = [
  'Future Interest',
  'Registration of Interest',
  'Waitlist',
  'Strong Interest',
  'Pending Deposit',
  'Deposit Received',
  'Ready to Process',
  'Closed Come Back',
  'Closed Lost',
];

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
    const customers = await base(TABLE_CUSTOMERS)
      .select({
        maxRecords: 3,
        filterByFormula: `LOWER({${AIRTABLE_CUSTOMERS_EMAIL_FIELD}}) = '${escapeFormulaString(email)}'`,
      })
      .firstPage();

    const customer = customers[0];
    if (!customer) {
      return sendJson(res, 200, { email, records: [] });
    }

    const fields = customer.fields;
    const bookingCrmTable = TABLE_BOOKING_CRM || TABLE_LEADS;
    const [bookings, leads] = await Promise.all([
      fetchRecordsByIds(base, TABLE_BOOKINGS, asArray(fields.Bookings)),
      fetchRecordsByIds(base, bookingCrmTable, asArray(fields['Booking CRM'])),
    ]);

    const tripIds = unique([
      ...asArray(fields['Current Trips']).filter(isRecordId),
      ...asArray(fields['Past Trips']).filter(isRecordId),
      ...bookings.flatMap((booking) => asArray(booking.fields.Trip)),
      ...leads.flatMap((lead) => asArray(lead.fields.Trips)),
    ]);
    const trips = await fetchRecordsByIds(base, TABLE_TRIPS, tripIds);
    const tripMap = new Map(trips.map((trip) => [trip.id, trip]));

    const shapedCustomer = {
      id: customer.id,
      fields,
      stackerUrl: `https://leatherbacktravel.stackerhq.com/crm/customers/view/cus_${customer.id}`,
      calendlyUrl: `https://calendly.com/d/cngz-qzq-yt7?email=${encodeURIComponent(String(fields['Client Email'] || email))}`,
    };

    return sendJson(res, 200, {
      email,
      records: [{ id: customer.id, fields }],
      customer: shapedCustomer,
      leads: shapeLeads(leads, tripMap),
      bookings: shapeBookings(bookings, tripMap),
    });
  } catch (error) {
    console.error('Airtable lookup failed', error);
    return sendJson(res, 500, {
      error: 'Airtable lookup failed',
      details: getErrorMessage(error),
    });
  }
}

async function fetchRecordsByIds(base, tableName, ids) {
  if (!tableName || !ids.length) return [];
  const records = await Promise.all(
    unique(ids)
      .filter(isRecordId)
      .map(async (id) => {
        try {
          return await base(tableName).find(id);
        } catch (error) {
          console.warn(`Could not fetch ${tableName} record ${id}`, getErrorMessage(error));
          return null;
        }
      })
  );
  return records.filter(Boolean);
}

function shapeLeads(records, tripMap) {
  return records
    .map((record) => {
      const fields = record.fields;
      const status = String(fields.Status || '');
      const trip = tripMap.get(asArray(fields.Trips)[0]);
      const dateRaw = firstValue(fields['Date Created'] || fields['Date Added']);
      return {
        id: record.id,
        status,
        trip: buildShortTripName(fields, trip?.fields) || firstValue(fields['D-Future-Trip-Requests']) || formatValue(fields['D-Future-Trip-Tags']) || 'Trip not set',
        dateAdded: formatShortDate(dateRaw),
        dateAddedTimestamp: parseDate(dateRaw)?.getTime() || 0,
        stackerUrl: `https://leatherbacktravel.stackerhq.com/crm/booking-crm/view/bcr_${record.id}`,
        futureTripRequests: firstValue(fields['D-Future-Trip-Requests']) || formatValue(fields['D-Future-Trip-Tags']),
      };
    })
    .filter((lead) => OPEN_LEAD_STATUSES.includes(lead.status))
    .sort((a, b) => b.dateAddedTimestamp - a.dateAddedTimestamp);
}

function shapeBookings(records, tripMap) {
  const today = startOfDay(new Date());
  const rows = records.map((record) => {
    const fields = record.fields;
    const trip = tripMap.get(asArray(fields.Trip)[0]);
    const tripFields = trip?.fields || {};
    const startDateRaw = firstValue(fields['Trip Start Date'] || tripFields['Start Date']);
    const endDateRaw = firstValue(fields['AUT: Trip End Date'] || fields['Finish Date (from Trip)'] || tripFields['Finish Date']);
    const startDate = parseDate(startDateRaw);
    const endDate = parseDate(endDateRaw);
    const cancelled = Boolean(fields.Cancelled);
    const group = getBookingGroup({ cancelled, startDate, endDate, today });

    return {
      id: record.id,
      name: firstValue(tripFields['Trip Title & Code']) || firstValue(fields['Trip Title']) || firstValue(fields['Booking ID']) || 'Trip not set',
      startDate: formatShortDate(startDateRaw),
      endDate: formatShortDate(endDateRaw),
      startTimestamp: startDate?.getTime() || 0,
      endTimestamp: endDate?.getTime() || 0,
      group,
      stackerUrl: `https://leatherbacktravel.stackerhq.com/crm/bookings/view/boo_${record.id}`,
    };
  });

  return {
    active: rows.filter((row) => row.group === 'active' || row.group === 'recent').sort((a, b) => a.endTimestamp - b.endTimestamp),
    upcoming: rows.filter((row) => row.group === 'upcoming').sort((a, b) => a.startTimestamp - b.startTimestamp),
    past: rows.filter((row) => row.group === 'past').sort((a, b) => b.endTimestamp - a.endTimestamp),
    cancelled: rows.filter((row) => row.group === 'cancelled').sort((a, b) => b.startTimestamp - a.startTimestamp),
  };
}

function getBookingGroup({ cancelled, startDate, endDate, today }) {
  if (cancelled) return 'cancelled';
  if (startDate && endDate && startDate <= today && endDate >= today) return 'active';
  if (endDate && endDate < today && daysBetween(endDate, today) <= 30) return 'recent';
  if (startDate && startDate > today) return 'upcoming';
  return 'past';
}

function buildShortTripName(leadFields, tripFields = {}) {
  const name = firstValue(leadFields['AUT: Nice Name']) || firstValue(tripFields['AUT: Nice Name']) || firstValue(tripFields['Trip Title & Code']) || firstValue(leadFields['Trip Name']);
  const date = firstValue(leadFields['Trip Start Date']) || firstValue(tripFields['Start Date']);
  return [name, formatShortDate(date)].filter(Boolean).join(' ');
}

function firstValue(value) {
  if (Array.isArray(value)) return firstValue(value[0]);
  if (value && typeof value === 'object') return value.name || value.email || value.url || JSON.stringify(value);
  return value ? String(value) : '';
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isRecordId(value) {
  return typeof value === 'string' && /^rec[a-zA-Z0-9]+$/.test(value);
}

function formatShortDate(value) {
  const raw = value instanceof Date ? value.toISOString() : firstValue(value);
  if (!raw) return '';

  const date = parseDate(raw);
  if (!date) return raw;

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function parseDate(value) {
  const raw = firstValue(value);
  if (!raw) return null;

  const friendlyMatch = raw.match(/\(([^)]+)\)/);
  const date = new Date(friendlyMatch?.[1] || raw);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(start, end) {
  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

function formatValue(value) {
  if (Array.isArray(value)) return value.map(firstValue).filter(Boolean).join(', ');
  return firstValue(value);
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
