import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

export default function Chat() {
  const chat = useStore((s) => s.chat);
  const sendChat = useStore((s) => s.sendChat);
  const playerId = useStore((s) => s.playerId);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.length]);

  const send = () => {
    if (!text.trim()) return;
    sendChat(text);
    setText('');
  };

  return (
    <div className="panel chat-panel">
      <div className="panel-title">Table talk</div>
      <div className="chat-list" ref={listRef}>
        {chat.length === 0 && <div className="chat-empty">Say hi to the table 👋</div>}
        {chat.map((m, i) => (
          <div key={i} className={`chat-msg ${m.playerId === playerId ? 'mine' : ''}`}>
            <span className={`chat-name ${m.team ?? ''}`}>{m.name}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-input-row">
        <input
          value={text}
          maxLength={300}
          placeholder="Message…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button className="btn btn-secondary btn-sm" onClick={send}>
          ➤
        </button>
      </div>
    </div>
  );
}
