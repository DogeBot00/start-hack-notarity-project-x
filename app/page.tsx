import BookingFlow from './BookingFlow';

export default function Page() {
  return (
    <main className="shell">
      <div className="brand">
        <span className="dot" />
        notarity&nbsp;<small>· book in minutes</small>
      </div>
      <BookingFlow />
    </main>
  );
}
