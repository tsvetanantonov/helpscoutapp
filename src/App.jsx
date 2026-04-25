import HelpScout from '@helpscout/javascript-sdk';
import { DefaultStyle, Heading, Spinner, Text, useSetAppHeight } from '@helpscout/ui-kit';
import { useEffect, useMemo, useState } from 'react';

function App() {
  const appRef = useSetAppHeight();
  const [context, setContext] = useState(null);
  const [customerData, setCustomerData] = useState(null);
  const [status, setStatus] = useState('loading-context');
  const [error, setError] = useState('');
  const [page, setPage] = useState('home');

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
    setPage('home');

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
      ) : page === 'currentTrips' ? (
        <TripsPage title="Future Trips" trips={customer?.currentTrips || []} onBack={() => setPage('home')} />
      ) : page === 'pastTrips' ? (
        <TripsPage title="Past Trips" trips={customer?.pastTrips || []} onBack={() => setPage('home')} />
      ) : (
        <HomePage
          customer={customer}
          customerData={customerData}
          fields={fields}
          onCurrentTrips={() => setPage('currentTrips')}
          onPastTrips={() => setPage('pastTrips')}
        />
      )}
    </main>
  );
}

function HomePage({ customer, customerData, fields, onCurrentTrips, onPastTrips }) {
  const age = fields.Age;
  const phone = fields['Phone Number'];
  const clientFlag = fields['Client Flag'];
  const notFit = Boolean(fields['Not a Fit']);
  const currentTrips = customer?.currentTrips || [];
  const pastTrips = customer?.pastTrips || [];
  const leads = customerData?.leads || { active: [], futureInterest: [] };

  return (
    <>
      <header className="topbar">
        <Heading level="h1">Airtable</Heading>
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

      <section className="gridTwo">
        <TripMetric label="Future Trips" count={currentTrips.length} onClick={onCurrentTrips} />
        <TripMetric label="Past Trips" count={pastTrips.length} onClick={onPastTrips} />
      </section>

      <LeadsSection title="Leads" leads={leads.active} />
      <FutureInterestSection leads={leads.futureInterest} />

      <a className="primaryButton" href={customer?.calendlyUrl} rel="noreferrer" target="_blank">
        Calendly link
      </a>
    </>
  );
}

function LeadsSection({ title, leads }) {
  if (!leads?.length) return null;

  return (
    <section className="section">
      <Heading level="h2">{title}</Heading>
      <div className="leadList">
        {leads.map((lead) => (
          <article className="lead" key={lead.id}>
            <div className="leadTitle" title={lead.status}>
              {lead.abbreviation} - {lead.shortTripName || 'Trip not set'} :
            </div>
            {lead.notes && <div className="leadNotes">{lead.notes}</div>}
          </article>
        ))}
      </div>
    </section>
  );
}

function FutureInterestSection({ leads }) {
  if (!leads?.length) return null;

  return (
    <section className="section">
      <Heading level="h2">Future Interest Leads</Heading>
      <div className="leadList">
        {leads.map((lead) => (
          <article className="lead" key={lead.id}>
            <div className="leadTitle" title={lead.status}>
              {lead.futureTripRequests || 'No future trip tags'}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TripsPage({ title, trips, onBack }) {
  return (
    <>
      <header className="topbar">
        <Heading level="h1">{title}</Heading>
      </header>
      <section className="tripSection">
        {trips.length ? (
          <div className="tripList">
            {trips.map((trip, index) => (
              <div
                className={trip.cancelled ? 'tripItem cancelled' : 'tripItem'}
                key={`${trip.id || trip.name}-${index}`}
              >
                {trip.name}
              </div>
            ))}
          </div>
        ) : (
          <Text>No trips found.</Text>
        )}
      </section>
      <button className="secondaryButton" onClick={onBack} type="button">
        Back
      </button>
    </>
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

function TripMetric({ label, count, onClick }) {
  return (
    <button className="metric metricButton" onClick={onClick} type="button">
      <Text size={11} className="label">{label}</Text>
      <span>{count}</span>
    </button>
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
  navigator.clipboard?.writeText(text);
}

export default App;
