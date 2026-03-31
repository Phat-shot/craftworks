// src/pages/ChatPage.jsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../App';
import { api, getSocket } from '../api';
import Avatar from '../components/Avatar';

export default function ChatPage() {
  const { userId }     = useParams();
  const { user }       = useAuth();
  const { t }          = useTranslation();
  const navigate       = useNavigate();
  const [convos,    setConvos]    = useState([]);
  const [messages,  setMessages]  = useState([]);
  const [active,    setActive]    = useState(userId || null);
  const [activeUser, setActiveUser] = useState(null);
  const [input,     setInput]     = useState('');
  const [typing,    setTyping]    = useState('');
  const messagesEndRef = useRef(null);
  const typingTimer = useRef(null);

  // Load conversations
  useEffect(() => {
    api.get('/chat/conversations').then(r => setConvos(r.data)).catch(()=>{});
  }, []);

  // Load messages when active changes
  useEffect(() => {
    if (!active) return;
    setMessages([]);
    api.get(`/chat/dm/${active}`).then(r => setMessages(r.data)).catch(()=>{});
    api.get(`/users/${active}`).then(r => setActiveUser(r.data)).catch(()=>{});
    if (userId !== active) navigate(`/chat/${active}`, { replace: true });
  }, [active]);

  // Socket listeners
  useEffect(() => {
    const socket = getSocket();

    socket.on('chat:dm', (msg) => {
      const fromId = msg.from || msg.sender_id;
      if (fromId === active || msg.recipient_id === active) {
        setMessages(m => [...m, msg]);
        scrollBottom();
      }
      // Refresh conversations
      api.get('/chat/conversations').then(r => setConvos(r.data)).catch(()=>{});
    });

    socket.on('chat:dm:sent', (msg) => {
      setMessages(m => [...m, { ...msg, sender_id: user.id }]);
      scrollBottom();
    });

    socket.on('chat:typing', ({ from, username: name }) => {
      if (from === active) {
        setTyping(`${name} schreibt…`);
        clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTyping(''), 2500);
      }
    });

    return () => {
      socket.off('chat:dm'); socket.off('chat:dm:sent'); socket.off('chat:typing');
    };
  }, [active, user.id]);

  const scrollBottom = () => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  useEffect(scrollBottom, [messages]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!input.trim() || !active) return;
    const socket = getSocket();
    socket.emit('chat:dm', { to: active, content: input.trim() });
    setInput('');
  };

  const onType = (v) => {
    setInput(v);
    if (active) getSocket().emit('chat:typing', { to: active });
  };

  const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="chat-layout" style={{ height: '100%' }}>
      {/* Conversation list */}
      <div className="chat-sidebar">
        <div className="page-header" style={{ padding: '12px 16px' }}>
          <span style={{ fontWeight: 700 }}>💬 {t('chat')}</span>
        </div>
        <div className="chat-list">
          {convos.length === 0 && (
            <div className="empty-state" style={{ padding: 24 }}>
              <div>Noch keine Chats.<br />Suche Freunde und schreibe ihnen.</div>
            </div>
          )}
          {convos.map(c => (
            <div
              key={c.other_id}
              className={`chat-item${active === c.other_id ? ' active' : ''}`}
              onClick={() => setActive(c.other_id)}
            >
              <div className="avatar-wrap">
                <div className="avatar avatar-md" style={{ background: c.avatar_color || '#4a90e2' }}>
                  {c.other_name?.slice(0,2).toUpperCase()}
                </div>
                {c.online && <span className="online-dot" />}
              </div>
              <div className="chat-item-info">
                <div className="chat-item-name">{c.other_name}</div>
                <div className="chat-item-preview">{c.last_message}</div>
              </div>
              {c.unread > 0 && <span className="chat-unread">{c.unread}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Messages pane */}
      <div className={`chat-main${active ? ' active' : ''}`}>
        {!active ? (
          <div className="empty-state flex-center" style={{ height: '100%' }}>
            <div>
              <div className="empty-icon">💬</div>
              Wähle einen Chat
            </div>
          </div>
        ) : (
          <>
            <div className="chat-header">
              <button className="btn btn-ghost btn-sm" onClick={() => { setActive(null); navigate('/chat'); }}>←</button>
              {activeUser && (
                <>
                  <div className="avatar-wrap">
                    <div className="avatar avatar-sm" style={{ background: activeUser.avatar_color || '#4a90e2' }}>
                      {activeUser.username?.slice(0,2).toUpperCase()}
                    </div>
                    {activeUser.online && <span className="online-dot" />}
                  </div>
                  <span style={{ fontWeight: 600 }}>{activeUser.username}</span>
                  <span style={{ fontSize: 11, color: activeUser.online ? 'var(--green)' : 'var(--text3)', marginLeft: 4 }}>
                    {activeUser.online ? `● ${t('online')}` : t('offline')}
                  </span>
                </>
              )}
            </div>

            <div className="chat-messages">
              {messages.map((m, i) => {
                const mine = m.sender_id === user.id;
                return (
                  <div key={m.id || i} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                    <div className={`chat-bubble ${mine ? 'mine' : 'theirs'}`}>{m.content}</div>
                    <div className="chat-bubble-meta">{formatTime(m.created_at)}</div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="typing-indicator">{typing}</div>

            <form className="chat-input-row" onSubmit={sendMessage}>
              <input
                className="input"
                value={input}
                onChange={e => onType(e.target.value)}
                placeholder={t('type_message')}
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary btn-sm" type="submit" disabled={!input.trim()}>
                {t('send')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
