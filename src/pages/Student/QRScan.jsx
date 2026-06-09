import { useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Webcam from 'react-webcam';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '../../api/client';
import { useTheme } from '../../context/ThemeContext';

const TIMEOUT_MS = 30_000;
const SCAN_INTERVAL_MS = 600;


function dataUrlToFile(dataUrl, filename = 'frame.jpg') {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bstr = atob(data);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

// Extract the JWT token from the QR content.
// QR encodes a URL like: http://localhost:5173/student/scan?token=<jwt>
// Fall back to using the raw text if it's not a URL (future-proof).
function extractToken(text) {
  try {
    const url = new URL(text);
    const token = url.searchParams.get('token');
    if (token) return token;
  } catch {
    // not a URL — treat the raw text as the token
  }
  return text;
}

export default function QRScan() {
  const navigate = useNavigate();
  const { theme: t } = useTheme();
  const webcamRef   = useRef(null);
  const decoderRef  = useRef(null);
  const intervalRef = useRef(null);
  const timerRef    = useRef(null);
  const busyRef     = useRef(false);
  const resolvedRef = useRef(false);
  const scanDirRef  = useRef(1);

  const [status,  setStatus]  = useState('loading');
  const [scanPos, setScanPos] = useState(5);
  const [error,   setError]   = useState('');

  // Report modal state
  const [scannedToken,    setScannedToken]    = useState(null);
  const [notifySuccess,   setNotifySuccess]   = useState(false);

  useEffect(() => {
    decoderRef.current = new Html5Qrcode('qr-decode-worker');
    return () => {
      clearInterval(intervalRef.current);
      clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (status !== 'scanning') { setScanPos(5); return; }
    const id = setInterval(() => {
      setScanPos(p => {
        const next = p + scanDirRef.current * 0.6;
        if (next >= 88) { scanDirRef.current = -1; return 88; }
        if (next <= 5)  { scanDirRef.current =  1; return 5; }
        return next;
      });
    }, 18);
    return () => clearInterval(id);
  }, [status]);

  const stopScanning = useCallback(() => {
    clearInterval(intervalRef.current);
    clearTimeout(timerRef.current);
  }, []);

  // QR scanned successfully — extract token, pass it to FaceVerify.
  // No backend call here; attendance submit happens after face verification.
  function handleQRScanned(rawText) {
    const qrToken = extractToken(rawText);
    setScannedToken(qrToken);
    navigate('/student/verify', { state: { qr_token: qrToken } });
  }

  const startScanning = useCallback(() => {
    if (resolvedRef.current) return;
    setStatus('scanning');

    timerRef.current = setTimeout(() => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      stopScanning();
      setStatus('timeout');
    }, TIMEOUT_MS);

    intervalRef.current = setInterval(async () => {
      if (resolvedRef.current || busyRef.current) return;
      if (!webcamRef.current || !decoderRef.current) return;

      const screenshot = webcamRef.current.getScreenshot();
      if (!screenshot) return;

      busyRef.current = true;
      try {
        const file = dataUrlToFile(screenshot);
        const text = await decoderRef.current.scanFile(file, false);
        if (text && !resolvedRef.current) {
          resolvedRef.current = true;
          stopScanning();
          setStatus('success');
          handleQRScanned(text);
        }
      } catch {
        // No QR in frame — keep polling
      } finally {
        busyRef.current = false;
      }
    }, SCAN_INTERVAL_MS);
  }, [stopScanning]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUserMedia      = useCallback(() => startScanning(), [startScanning]);
  const handleUserMediaError = useCallback(() => setStatus('denied'), []);

  // Dev bypass: navigate directly with a mock token
  const devMockScan = useCallback(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    stopScanning();
    setStatus('success');
    navigate('/student/verify', { state: { qr_token: 'dev-mock-token-123' } });
  }, [navigate, stopScanning]);

  const handleRetry = useCallback(() => {
    resolvedRef.current = false;
    setError('');
    setStatus('loading');
  }, []);





  const scanning = status === 'scanning' || status === 'loading';
  const failed   = status === 'denied'   || status === 'timeout';
  const vfSize   = 'min(270px, 80vw)';

  return (
    <div style={{ background: t.bg, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <style>{`@keyframes qr-pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>

      {/* ── Header ── */}
      <header style={{
        background: t.hdr, borderBottom: `1px solid ${t.bdr}`,
        display: 'flex', alignItems: 'center', padding: '14px 18px', flexShrink: 0,
      }}>
        <button type="button" onClick={() => navigate('/student/dashboard')} aria-label="Back"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex', alignItems: 'center' }}>
          <BackArrowIcon color={t.txt} />
        </button>
        <h1 style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: 800, color: t.txt, margin: 0, letterSpacing: -0.3 }}>
          Scan QR Code
        </h1>
        <div style={{ width: 40 }} />
      </header>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 20px', gap: 20 }}>

        {/* ══ SCANNING STATE ══ */}
        {scanning && (
          <>
            <p style={{ fontSize: 13, color: t.txtL, textAlign: 'center', lineHeight: 1.6, margin: 0, maxWidth: 280 }}>
              Point your camera at the QR code displayed on the projector screen
            </p>

            {/* Viewfinder */}
            <div style={{ position: 'relative', width: vfSize, height: vfSize }}>
              <div style={{ width: '100%', height: '100%', borderRadius: 20, background: '#060412', overflow: 'hidden', position: 'relative' }}>
                <Webcam
                  ref={webcamRef} audio={false}
                  screenshotFormat="image/jpeg" screenshotQuality={0.85}
                  videoConstraints={{ facingMode: 'environment' }}
                  onUserMedia={handleUserMedia} onUserMediaError={handleUserMediaError}
                  mirrored={false}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                <div aria-hidden="true" style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.05,
                  backgroundImage: ['linear-gradient(#fff 1px,transparent 1px)', 'linear-gradient(90deg,#fff 1px,transparent 1px)'].join(','),
                  backgroundSize: '26px 26px',
                }} />
                {status === 'scanning' && (
                  <div aria-hidden="true" style={{
                    position: 'absolute', left: 0, right: 0, height: 2,
                    background: 'linear-gradient(90deg,transparent,#e11d48,#fb7185,#e11d48,transparent)',
                    boxShadow: '0 0 12px rgba(244,63,94,.6)',
                    top: `${scanPos}%`, transition: 'top .018s linear', pointerEvents: 'none',
                  }} />
                )}
              </div>
              {[
                { top: 0,    left: 0,    borderTop: `3px solid ${t.pri}`,    borderLeft:   `3px solid ${t.pri}`, borderRadius: '12px 0 0 0'  },
                { top: 0,    right: 0,   borderTop: `3px solid ${t.pri}`,    borderRight:  `3px solid ${t.pri}`, borderRadius: '0 12px 0 0'  },
                { bottom: 0, left: 0,    borderBottom: `3px solid ${t.pri}`, borderLeft:   `3px solid ${t.pri}`, borderRadius: '0 0 0 12px' },
                { bottom: 0, right: 0,   borderBottom: `3px solid ${t.pri}`, borderRight:  `3px solid ${t.pri}`, borderRadius: '0 0 12px 0' },
              ].map((s, i) => (
                <div key={i} aria-hidden="true" style={{ position: 'absolute', width: 26, height: 26, pointerEvents: 'none', ...s }} />
              ))}
            </div>

            {/* Status row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: t.acc, animation: 'qr-pulse 1.4s infinite' }} />
              <span style={{ fontSize: 12, color: t.txtL }}>Searching for QR code...</span>
            </div>

            {/* Having trouble? */}

            {/* Dev bypass */}
            {import.meta.env.DEV && (
              <button type="button" onClick={devMockScan} style={{
                background: t.card, border: `1.5px solid ${t.bdr}`, borderRadius: 10,
                padding: '8px 16px', fontSize: 12, fontWeight: 700, color: t.txtL,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                fontFamily: "'DM Sans', sans-serif",
              }}>
                <BeakerIcon color={t.txtL} />
                Dev: Mock Scan
              </button>
            )}
          </>
        )}

        {/* ══ SUCCESS STATE ══ */}
        {status === 'success' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, width: '100%', textAlign: 'center' }}>
            <div style={{ width: 88, height: 88, borderRadius: '50%', background: t.okL, border: '3px solid rgba(5,150,105,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckLgIcon color={t.ok} />
            </div>
            <div>
              <h2 style={{ fontSize: 19, fontWeight: 800, color: t.txt, margin: '0 0 6px', letterSpacing: -0.3 }}>QR Code Scanned</h2>
              <p style={{ fontSize: 13, color: t.txtL, margin: 0 }}>Proceeding to face verification…</p>
            </div>
          </div>
        )}

        {/* ══ FAILED STATE ══ */}
        {failed && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, width: '100%', textAlign: 'center' }}>
            <div style={{ width: 88, height: 88, borderRadius: '50%', background: t.accL, border: `3px solid ${t.accLL}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <WarningCircleIcon color={t.acc} />
            </div>
            <div>
              <h2 style={{ fontSize: 19, fontWeight: 800, color: t.txt, margin: '0 0 6px', letterSpacing: -0.3 }}>
                {error ? 'Scan Failed' : 'QR Scan Failed'}
              </h2>
              <p style={{ fontSize: 13, color: t.txtL, lineHeight: 1.6, margin: 0 }}>
                {error || "We couldn't detect a QR code. Try the tips below."}
              </p>
            </div>
            <div style={{ background: t.accL, borderRadius: 14, padding: '14px 16px', border: `1px solid ${t.accLL}`, width: '100%', textAlign: 'left' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: t.acc, margin: '0 0 6px' }}>Why might this happen?</p>
              {['QR code may be too far or not clearly visible', 'Poor lighting conditions in the room', 'Camera access was denied or unavailable'].map((r) => (
                <p key={r} style={{ fontSize: 12, color: t.txtL, margin: '0 0 4px', lineHeight: 1.5 }}>· {r}</p>
              ))}
            </div>
            <button type="button" onClick={handleRetry} style={{
              width: '100%', padding: 12, borderRadius: 12,
              border: `1.5px solid ${t.bdr}`, background: t.card,
              fontSize: 13, fontWeight: 700, color: t.txtL,
              cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
            }}>
              Try Again
            </button>
          </div>
        )}

        <div id="qr-decode-worker" aria-hidden="true"
          style={{ position: 'absolute', left: '-9999px', top: 0, width: 1, height: 1, overflow: 'hidden' }} />
      </div>


    </div>
  );
}

/* ── SVG icons ── */

function BackArrowIcon({ color }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function CheckLgIcon({ color }) {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function WarningCircleIcon({ color }) {
  return (
    <svg width="38" height="38" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8v4" /><path d="M12 16h.01" />
      <path d="M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10z" />
    </svg>
  );
}

function BeakerIcon({ color }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6v11l4 7H5l4-7V3z" /><line x1="9" y1="9" x2="15" y2="9" />
    </svg>
  );
}