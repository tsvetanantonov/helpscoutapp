import HelpScout from '@helpscout/javascript-sdk';
import { DefaultStyle, Heading, Spinner, Text, useSetAppHeight } from '@helpscout/ui-kit';
import { useEffect, useMemo, useState } from 'react';

const FIELD_PREFERENCES = {
  name: ['Client', 'Preferred Name', 'First Name', 'Name', 'Full Name', 'Customer Name', 'Contact Name'],
  status: ['Travel Profile Status', 'Status', 'Stage', 'Customer Status'],
  phone: ['Phone Number', 'Phone', 'Mobile'],
  altEmail: ['Alt Email', 'Alt Email 2'],
  flag: ['Client Flag'],
  currentTrips: ['Current Trips', 'TripsBooked', 'Trips'],
  pastTrips: ['Past Trips'],
  activeBookings: ['Active Bookings', 'Upcoming Trips #', 'Total # of Bookings'],
  lastBookingDate: ['Last Booking Date'],
  notes: ['About Guest', 'Action Items', 'Marketing Notes', 'Medical & Other', 'Dietary Restrictions'],
};

function App() {
  const appRef = useSetAppHeight();
  const [context, setContext] = useState(null);
  const [customerData, setCustomerData] = useState(null);
  const [status, setStatus] = useState('loading-context');
  const [error, setError] = useState('');

  const email = useMemo(() => getCustomerEmail(context?.customer), [context]);

  useEffect(() => {
    let active = true;
    const localEmail = new URLSearchParams(window.location.search).get('email');

    if (localEmail) {
      setContext({ customer: { email: localEmail } });
      setStatus('ready');
      return () => {
        active = false;
      };
    }

    HelpScout.getApplicationContext()
      .then((nextContext) => {
        if (!active) return;
        setContext(nextContext);
        setStatus('ready');
      })
      .catch(() => {
        if (!active) return;
        setStatus('context-error');
        setError('Could not read Help Scout conversation context.');
      });

    const unsubscribe = HelpScout.watchApplicationContext?.((nextContext) => {
      setContext(nextContext);
    });

    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!email) {
      if (status === 'ready') setCustomerData(null);
      return;
    }

    let active = true;
    setStatus('loading-airtable');
    setError('');

    fetch(`/api/airtable?email=${encodeURIComponent(email)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error([body.error, body.details].filter(Boolean).join(': ') || 'Airtable lookup failed.');
        }
        return body;
      })
      .then((body) => {
        if (!active) return;
        setCustomerData(body);
        setStatus('ready');
      })
      .catch((lookupError) => {
        if (!active) return;
        setCustomerData(null);
        setStatus('airtable-error');
        setError(lookupError.message);
      });

    return () => {
      active = false;
    };
  }, [email]);

  const record = customerData?.records?.[0];
  const fields = record?.fields || {};

  return (
    <main className="app" ref={appRef}>
      <DefaultStyle />
      <header className="header">
        <Heading level="h1">Airtable Customer</Heading>
        {email && <Text size={13}>{email}</Text>}
      </header>

      {status === 'loading-context' || status === 'loading-airtable' ? (
        <LoadingState />
      ) : error ? (
        <Message title="Could not load customer" text={error} />
      ) : !email ? (
        <Message title="No customer email" text="This Help Scout conversation does not include an email address yet." />
      ) : !record ? (
        <Message title="No Airtable match" text="No customer record was found for this email address." />
      ) : (
        <section className="profile">
          <div>
            <Text size={12} className="label">Name</Text>
            <Heading level="h2">{getCustomerName(fields) || 'Unnamed customer'}</Heading>
          </div>

          <Detail label="Travel profile" value={pickField(fields, FIELD_PREFERENCES.status)} />
          <Detail label="Phone" value={pickField(fields, FIELD_PREFERENCES.phone)} />
          <Detail label="Alt email" value={pickField(fields, FIELD_PREFERENCES.altEmail)} />
          <Detail label="Active bookings" value={pickField(fields, FIELD_PREFERENCES.activeBookings)} />
          <Detail label="Current trips" value={pickField(fields, FIELD_PREFERENCES.currentTrips)} />
          <Detail label="Past trips" value={pickField(fields, FIELD_PREFERENCES.pastTrips)} />
          <Detail label="Last booking date" value={pickField(fields, FIELD_PREFERENCES.lastBookingDate)} />
          <Detail label="Client flag" value={pickField(fields, FIELD_PREFERENCES.flag)} multiline />
          <Detail label="Notes" value={pickField(fields, FIELD_PREFERENCES.notes)} multiline />

          <details className="raw">
            <summary>All Airtable fields</summary>
            <dl>
              {Object.entries(fields).map(([key, value]) => (
                <div className="field" key={key}>
                  <dt>{key}</dt>
                  <dd>{formatValue(value)}</dd>
                </div>
              ))}
            </dl>
          </details>
        </section>
      )}
    </main>
  );
}

function LoadingState() {
  return (
    <div className="message">
      <Spinner />
      <Text>Loading customer data...</Text>
    </div>
  );
}

function Message({ title, text }) {
  return (
    <section className="message">
      <Heading level="h2">{title}</Heading>
      <Text>{text}</Text>
    </section>
  );
}

function Detail({ label, value, multiline = false }) {
  if (!value) return null;

  return (
    <div className={multiline ? 'detail detailMultiline' : 'detail'}>
      <Text size={12} className="label">{label}</Text>
      <Text>{formatValue(value)}</Text>
    </div>
  );
}

function getCustomerEmail(customer) {
  if (!customer) return '';
  if (typeof customer.email === 'string') return customer.email;

  const firstEmail = customer.emails?.[0];
  if (typeof firstEmail === 'string') return firstEmail;
  if (typeof firstEmail?.value === 'string') return firstEmail.value;
  if (typeof firstEmail?.email === 'string') return firstEmail.email;

  return '';
}

function pickField(fields, names) {
  for (const name of names) {
    if (fields[name]) return fields[name];
  }
  return '';
}

function getCustomerName(fields) {
  const directName = pickField(fields, FIELD_PREFERENCES.name);
  if (directName) return directName;

  const firstName = fields['Preferred Name'] || fields['First Name'] || '';
  const surname = fields.Surname || '';
  return [firstName, surname].filter(Boolean).join(' ');
}

function formatValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '');
}

export default App;
