import { useState, useEffect } from 'react';

const LiveDateTime = ({ className = '' }) => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const dateStr = now.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  const timeStr = now.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });

  return (
    <div className={`${className}`}>
      <span className="text-xs font-medium text-gray-600">
        📅 {dateStr} &nbsp;|&nbsp; 🕐 {timeStr} IST
      </span>
    </div>
  );
};

export default LiveDateTime;
