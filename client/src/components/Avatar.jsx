// src/components/Avatar.jsx
import React from 'react';

export default function Avatar({ user, size = 'md', showOnline = false }) {
  const sizeClass = `avatar avatar-${size}`;
  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : '?';
  const color = user?.avatar_color || '#4a90e2';

  return (
    <div className="avatar-wrap">
      <div
        className={sizeClass}
        style={{ background: color }}
        title={user?.username}
      >
        {initials}
      </div>
      {showOnline && user?.online && <span className="online-dot" />}
    </div>
  );
}
