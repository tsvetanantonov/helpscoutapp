import HelpScout from '@helpscout/javascript-sdk';
import { DefaultStyle, Heading, Spinner, Text, useSetAppHeight } from '@helpscout/ui-kit';
import { useEffect, useMemo, useState } from 'react';

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
  const customer = customerData?.customer;
  const fields = customer?.fields || record?.fields || {};

  return (
    <main className="app" ref={appRef}>
      <DefaultStyle />

      {status === 'loading-context' || status === 'loading-airtable' ? (
        <LoadingState />
      ) : error ? (
        <Message title="Could not load customer" text={error} />
      ) : !email ? (
        <Message title="No customer email" text="This Help Scout conversation does not include an email address yet." />
      ) : !record ? (
        <Message title="No Airtable match" text="No customer record was found for this email address." />
      ) : (
        <HomePage customer={customer} customerData={customerData} fields={fields} />
      )}
    </main>
  );
}

function HomePage({ customer, customerData, fields }) {
  const age = fields.Age;
  const phone = fields['Phone Number'];
  const clientFlag = fields['Client Flag'];
  const notFit = Boolean(fields['Not a Fit']);
  const leads = customerData?.leads || [];
  const bookings = customerData?.bookings || {};

  return (
    <>
      <header className="topbar homeTopbar">
        {customer?.stackerUrl && (
          <a className="iconButton" href={customer.stackerUrl} rel="noreferrer" target="_blank" title="Open customer in Stacker">
            <span aria-hidden="true">↗</span>
          </a>
        )}
      </header>

      {notFit && <div className="alert">Not a Fit</div>}
      {clientFlag && <TextBlock label="Client Flag" value={clientFlag} tone="warning" />}

      <section className="summaryStack">
        <AgeMetric value={age} />
        <PhoneRow value={phone} />
      </section>

      <TripsSection bookings={bookings} />
      <LeadsTable leads={leads} />

      <a className="primaryButton" href={customer?.calendlyUrl} rel="noreferrer" target="_blank">
        Calendly link
      </a>
    </>
  );
}

function LeadsTable({ leads }) {
  if (!leads?.length) return null;

  return (
    <section className="section">
      <Heading level="h2">Leads</Heading>
      <div className="dataTable leadsTable">
        <div className="tableHeader">
          <span>Trip</span>
          <span>Status</span>
          <span>Date</span>
          <span />
        </div>
        {leads.map((lead) => (
          <div className="tableRow" key={lead.id}>
            <span className="mainCell">{lead.trip}</span>
            <span>{lead.status}</span>
            <span>{lead.dateAdded}</span>
            <ExternalLink href={lead.stackerUrl} label="Open lead" />
          </div>
        ))}
      </div>
    </section>
  );
}

function TripsSection({ bookings }) {
  const active = bookings.active || [];
  const upcoming = bookings.upcoming || [];
  const past = bookings.past || [];
  const cancelled = bookings.cancelled || [];

  if (!active.length && !upcoming.length && !past.length && !cancelled.length) return null;

  return (
    <section className="section">
      <Heading level="h2">Trips</Heading>
      <div className="tripGroups">
        <TripGroup rows={active} title="Active Trips" />
        <TripGroup rows={upcoming} title="Upcoming Trips" />
        <TripGroup rows={past} title="Past Trips" />
        <TripGroup rows={cancelled} title="Cancelled Trips" />
      </div>
    </section>
  );
}

function TripGroup({ rows, title }) {
  if (!rows?.length) return null;

  return (
    <div className="tripGroup">
      <div className="groupTitle">{title}</div>
      <div className="dataTable tripsTable">
        {rows.map((booking) => (
          <div className={`tableRow tripRow ${booking.group}`} key={booking.id}>
            <span className="mainCell">{booking.name}</span>
            <span>{booking.startDate}</span>
            <ExternalLink href={booking.stackerUrl} label="Open booking" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AgeMetric({ value }) {
  if (!hasValue(value)) return null;
  return (
    <div className="ageRow">
      <Text size={11} className="label">Age</Text>
      <span>{formatValue(value)}</span>
    </div>
  );
}

function PhoneRow({ value }) {
  if (!hasValue(value)) return null;
  const text = formatValue(value);

  return (
    <div className="phoneRow">
      <div>
        <Text size={11} className="label">Phone</Text>
        <span>{text}</span>
      </div>
      <button className="copyIconButton" onClick={() => copyText(text)} title="Copy phone" type="button">
        ⧉
      </button>
    </div>
  );
}

function ExternalLink({ href, label }) {
  return (
    <a className="rowLink" href={href} rel="noreferrer" target="_blank" title={label}>
      ↗
    </a>
  );
}

function TextBlock({ label, value, tone }) {
  if (!hasValue(value)) return null;
  return (
    <section className={tone === 'warning' ? 'copyBlock warningBlock' : 'copyBlock'}>
      <Text size={11} className="label">{label}</Text>
      <div className="plainText multiline">{formatValue(value)}</div>
    </section>
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

function getCustomerEmail(customer) {
  if (!customer) return '';
  if (typeof customer.email === 'string') return customer.email;

  const firstEmail = customer.emails?.[0];
  if (typeof firstEmail === 'string') return firstEmail;
  if (typeof firstEmail?.value === 'string') return firstEmail.value;
  if (typeof firstEmail?.email === 'string') return firstEmail.email;

  return '';
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
}

function formatValue(value) {
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(', ');
  if (value && typeof value === 'object') return value.name || value.email || value.url || JSON.stringify(value);
  return String(value ?? '');
}

function copyText(text) {
  if (HelpScout.setClipboardText) {
    HelpScout.setClipboardText(text, 'Phone copied');
    return;
  }

  navigator.clipboard?.writeText(text);
}

export default App;
