'use client';

import { useRouter } from 'next/navigation';

export default function PaymentCancelPage() {
  const router = useRouter();
  return (
    <main className="screen" style={{ padding: 24, textAlign: 'center' }}>
      <h1>No problem</h1>
      <p>Your subscription was not started. You can return to the plan choices when you are ready.</p>
      <button className="btn-primary" onClick={() => router.replace('/payment')}>Return to plans</button>
    </main>
  );
}