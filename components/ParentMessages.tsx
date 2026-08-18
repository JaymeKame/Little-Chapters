'use client';

/* In-app parent message display component */

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getDb } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';

interface Message {
  id: string;
  message: string;
  lines: string[];
  childName: string;
  createdAt: string;
  read: boolean;
  smsSent?: boolean;
}

export function ParentMessages() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // `loading` starts true and only ever cleared inside the snapshot
    // callback, so any early return left the panel on "Loading messages…"
    // forever. Resolve the two not-subscribing cases explicitly instead.
    if (authLoading) return;
    if (!user || !isAuthenticated) {
      // Messages belong to a registered parent; an anonymous visitor has none
      // to fetch, and subscribing under a throwaway uid just burns a read.
      setMessages([]);
      setLoading(false);
      return;
    }

    const db = getDb();
    const messagesRef = collection(db, 'parents', user.uid, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messagesData: Message[] = [];
      snapshot.forEach((doc) => {
        messagesData.push({ id: doc.id, ...doc.data() } as Message);
      });
      setMessages(messagesData);
      setLoading(false);
    }, (error) => {
      console.error('Error loading messages:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [authLoading, isAuthenticated, user]);

  async function markAsRead(messageId: string) {
    if (!user) return;
    try {
      const db = getDb();
      const messageRef = doc(db, 'parents', user.uid, 'messages', messageId);
      await updateDoc(messageRef, { read: true });
    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--ink-soft)' }}>
        Loading messages...
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--ink-soft)' }}>
        No messages yet. Complete a reading session to see progress updates!
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2 style={{ fontFamily: 'var(--serif)', fontSize: '20px', marginBottom: '16px' }}>
        Progress Updates
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            onClick={() => !msg.read && markAsRead(msg.id)}
            style={{
              background: msg.read ? 'var(--card)' : '#f0f7f2',
              border: `1px solid ${msg.read ? 'var(--line)' : 'var(--leaf)'}`,
              borderRadius: '12px',
              padding: '16px',
              cursor: !msg.read ? 'pointer' : 'default',
              transition: 'background-color 0.2s',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                {new Date(msg.createdAt).toLocaleDateString()}
              </span>
              {msg.smsSent && (
                <span style={{ fontSize: 11, background: 'var(--sunshine)', padding: '2px 8px', borderRadius: 999, color: '#fff' }}>
                  SMS sent
                </span>
              )}
            </div>
            <div style={{ whiteSpace: 'pre-line', fontSize: 14, lineHeight: 1.5 }}>
              {msg.lines.map((line, idx) => (
                <div key={idx} style={{ marginBottom: idx < msg.lines.length - 1 ? '4px' : '0' }}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
