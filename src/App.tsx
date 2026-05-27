/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Thermometer, Droplets, Activity, Settings, Radio, Sun, Moon, Lock, Unlock, X, Check, AlertCircle, Eye, EyeOff, Gauge } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { createMqttClient, topics } from './lib/mqtt';
import { cn } from './lib/utils';

interface TelemetryData {
  time: string;
  temp: number;
  humidity: number;
  pressure?: number;
}

export default function App() {
  const [temp, setTemp] = useState<number | null>(null);
  const [humidity, setHumidity] = useState<number | null>(null);
  const [pressure, setPressure] = useState<number | null>(null);
  const [status, setStatus] = useState<string>('OFFLINE');
  const [setpoint, setSetpoint] = useState<number | null>(null);
  const [hysteresis, setHysteresis] = useState<number | null>(null);
  const [history, setHistory] = useState<TelemetryData[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // MQTT publisher and secure parameter references
  const clientRef = useRef<any>(null);
  const humidityRef = useRef<number | null>(null);
  const pressureRef = useRef<number | null>(null);

  // Secure Password Confirmation States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tempSetpoint, setTempSetpoint] = useState('');
  const [tempHysteresis, setTempHysteresis] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passError, setPassError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [shouldShake, setShouldShake] = useState(false);

  const openConfigModal = () => {
    setTempSetpoint(setpoint !== null ? setpoint.toString() : '80.0');
    setTempHysteresis(hysteresis !== null ? hysteresis.toString() : '2.0');
    setPassword('');
    setPassError('');
    setIsSuccess(false);
    setIsModalOpen(true);
    setShouldShake(false);
  };

  const handleSubmitSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setPassError('');
    setShouldShake(false);

    const parsedSetpoint = parseFloat(tempSetpoint);
    const parsedHysteresis = parseFloat(tempHysteresis);

    if (isNaN(parsedSetpoint) || parsedSetpoint < 0 || parsedSetpoint > 100) {
      setPassError('Setpoint must be a valid number between 0% and 100%');
      setShouldShake(true);
      return;
    }

    if (isNaN(parsedHysteresis) || parsedHysteresis < 0.1 || parsedHysteresis > 20) {
      setPassError('Hysteresis range must be between 0.1% and 20%');
      setShouldShake(true);
      return;
    }

    // Authenticate secure passcode
    if (password !== 'faqih2026') {
      setPassError('ACCESS DENIED: INVALID SECURITY PROTOCOL PASSCODE');
      setShouldShake(true);
      return;
    }

    setIsVerifying(true);
    
    setTimeout(() => {
      setIsVerifying(false);
      setIsSuccess(true);
      
      // Update local states instantly
      setSetpoint(parsedSetpoint);
      setHysteresis(parsedHysteresis);
      
      // Publish target MQTT updates
      if (clientRef.current) {
        clientRef.current.publish(topics.setpointPub, parsedSetpoint.toFixed(1), { retain: true });
        clientRef.current.publish(topics.hysteresisPub, parsedHysteresis.toFixed(1), { retain: true });
      }

      // Auto close modal with transition
      setTimeout(() => {
        setIsModalOpen(false);
        setIsSuccess(false);
        setPassword('');
      }, 1500);
    }, 750);
  };

  // Theme Controller
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') return saved;
    }
    return 'light';
  });

  useEffect(() => {
    localStorage.setItem('theme', theme);
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Hysteresis Logic Calculation for Humidity
  const lowerBound = setpoint !== null && hysteresis !== null ? setpoint - hysteresis : null;
  const isInHysteresisZone = humidity !== null && setpoint !== null && lowerBound !== null && humidity >= lowerBound && humidity <= setpoint;
  const needsMoisture = humidity !== null && lowerBound !== null && humidity < lowerBound;

  const handleMessage = useCallback((topic: string, message: string) => {
    const val = parseFloat(message);
    
    switch (topic) {
      case topics.temperature:
        setTemp(val);
        setHistory(prev => {
          const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const newData = [...prev, { time: now, temp: val, humidity: humidityRef.current || 0, pressure: pressureRef.current || 0 }];
          return newData.slice(-30);
        });
        break;
      case topics.humidity:
        setHumidity(val);
        humidityRef.current = val;
        break;
      case topics.pressure:
        setPressure(val);
        pressureRef.current = val;
        break;
      case topics.status:
        setStatus(message);
        break;
      case topics.setpointSub:
        setSetpoint(val);
        break;
      case topics.hysteresisSub:
        setHysteresis(val);
        break;
    }
  }, []);

  useEffect(() => {
    const client = createMqttClient();
    clientRef.current = client;

    client.on('connect', () => {
      setIsConnected(true);
      setError(null);
      // Only subscribe to status and data incoming streams, keeping control write-only
      const subTopics = [
        topics.temperature,
        topics.humidity,
        topics.pressure,
        topics.status,
        topics.setpointSub,
        topics.hysteresisSub
      ];
      subTopics.forEach(t => client.subscribe(t));
    });

    client.on('message', (topic, message) => {
      setIsConnected(true);
      handleMessage(topic, message.toString());
    });

    client.on('error', (err) => {
      console.error('MQTT Error:', err);
      setError(err.message);
      setIsConnected(client.connected);
    });

    client.on('offline', () => {
      setIsConnected(false);
    });

    client.on('close', () => {
      setIsConnected(false);
    });
    
    // Periodically sync connection state with client.connected
    const interval = setInterval(() => {
      if (clientRef.current) {
        setIsConnected(clientRef.current.connected);
      }
    }, 1500);
    
    return () => { 
      clearInterval(interval);
      client.end(true); 
      clientRef.current = null;
    };
  }, [handleMessage]);

  return (
    <div className="w-full min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-10 flex flex-col gap-8 max-w-[1600px] mx-auto transition-colors duration-300">
      {/* Header Bento Card */}
      <header className="flex flex-col sm:flex-row justify-between items-center bg-white dark:bg-slate-900 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-800 shadow-sm gap-4 transition-colors duration-300">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-950/40 rounded-2xl flex items-center justify-center transition-colors duration-300">
            <Thermometer className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight transition-colors duration-300">TempeBox Monitor</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium transition-colors duration-300">
              HiveMQ Broker: <span className={cn(isConnected ? "text-emerald-500" : "text-red-500")}>
                {isConnected ? "Connected" : (error ? `Error: ${error}` : "Disconnected")}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-full text-[10px] font-extrabold text-slate-600 dark:text-slate-300 uppercase tracking-widest transition-colors duration-300">
            Node: FAQIH2026
          </div>
          <div className="px-4 py-2 bg-slate-900 dark:bg-slate-950 rounded-full text-[10px] font-extrabold text-white dark:text-slate-350 uppercase tracking-widest flex items-center gap-2 transition-colors duration-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live: {new Date().toLocaleTimeString()}
          </div>
          
          {/* Aesthetic Toggle Switch */}
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="p-2.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center cursor-pointer shadow-sm ml-1"
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={theme}
                initial={{ y: -6, opacity: 0, rotate: -45 }}
                animate={{ y: 0, opacity: 1, rotate: 0 }}
                exit={{ y: 6, opacity: 0, rotate: 45 }}
                transition={{ duration: 0.15 }}
                className="flex items-center justify-center"
              >
                {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4 text-emerald-400" />}
              </motion.div>
            </AnimatePresence>
          </button>
        </div>
      </header>

      {/* Main Bento Grid */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 grid-rows-none lg:grid-rows-6 gap-8">
        
        {/* Temp Card */}
        <div className="lg:col-span-3 lg:row-span-3 bento-card flex flex-col justify-between group">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">Temperature</span>
            <span className="text-emerald-500 dark:text-emerald-400 flex items-center gap-1 text-sm font-bold bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1 rounded-lg">
              Live <Activity className="w-3 h-3 animate-pulse" />
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-8">
            <motion.span 
              key={temp}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-6xl xl:text-7xl font-black text-slate-900 dark:text-slate-50 tracking-tighter"
            >
              {temp ? temp.toFixed(1) : '--.-'}
            </motion.span>
            <span className="text-3xl font-bold text-slate-300 dark:text-slate-700 tracking-tighter">°C</span>
          </div>
          <div className="w-full h-2 bg-slate-100 dark:bg-slate-850 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: temp ? `${(temp/50)*100}%` : '0%' }}
              className="h-full bg-emerald-500" 
            />
          </div>
        </div>

        {/* Humidity Card */}
        <div className="lg:col-span-3 lg:row-span-3 bento-card flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">Humidity</span>
            <span className="text-sky-500 dark:text-sky-450 text-xs font-bold tracking-tighter uppercase px-2 py-1 bg-sky-50 dark:bg-sky-950/30 rounded-lg">Ambient</span>
          </div>
          <div className="flex items-baseline gap-2 my-8">
            <motion.span 
              key={humidity}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-6xl xl:text-7xl font-black text-slate-900 dark:text-slate-50 tracking-tighter"
            >
              {humidity ? humidity.toFixed(1) : '--.-'}
            </motion.span>
            <span className="text-3xl font-bold text-slate-300 dark:text-slate-700 tracking-tighter">%</span>
          </div>
          <div className="flex gap-1 h-8 items-end">
            {[0.4, 0.6, 0.8, 1, 0.9, 1, 0.7, 0.5, 0.8].map((h, i) => (
              <div 
                key={i} 
                className="flex-1 bg-sky-500 rounded-full animate-pulse" 
                style={{ height: `${h * 100}%`, opacity: 0.3 + (i * 0.07), animationDelay: `${i * 100}ms` }} 
              />
            ))}
          </div>
        </div>

        {/* Pressure Card */}
        <div className="lg:col-span-3 lg:row-span-3 bento-card flex flex-col justify-between group">
          <div className="flex justify-between items-start">
            <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">Pressure</span>
            <span className="text-pink-500 dark:text-pink-400 flex items-center gap-1 text-sm font-bold bg-pink-50 dark:bg-pink-950/30 px-2 py-1 rounded-lg">
              Baro <Gauge className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-8">
            <motion.span 
              key={pressure}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-6xl xl:text-7xl font-black text-slate-900 dark:text-slate-50 tracking-tighter"
            >
              {pressure ? pressure.toFixed(1) : '--.-'}
            </motion.span>
            <span className="text-2xl font-bold text-slate-300 dark:text-slate-700 tracking-tighter">hPa</span>
          </div>
          <div className="w-full h-4 flex flex-col justify-between">
            <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-850 rounded-full relative overflow-hidden">
              <motion.div 
                initial={{ left: 0 }}
                animate={{ 
                  left: pressure ? `${Math.max(0, Math.min(100, ((pressure - 950) / 100) * 100))}%` : '50%' 
                }}
                className="absolute top-0 bottom-0 w-2.5 bg-pink-500 rounded-full -translate-x-1" 
              />
            </div>
            <div className="flex justify-between text-[8px] font-bold text-slate-400 dark:text-slate-600 mt-1 uppercase tracking-wide">
              <span>950 hPa</span>
              <span>1050 hPa</span>
            </div>
          </div>
        </div>

        {/* Sidebar Status (The Dark Bento) */}
        <div className="lg:col-span-3 lg:row-span-6 bento-sidebar relative overflow-hidden">
          <div className="space-y-10 relative z-10">
            <div>
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">System Health</span>
              <div className="mt-4 flex items-center gap-4">
                <div className={cn(
                  "w-4 h-4 rounded-full",
                  status === 'ON' ? "bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.5)]" : "bg-orange-400 text-transparent"
                )} />
                <p className="text-3xl font-bold tracking-tight">{status === 'ON' ? 'Mist ACTIVE' : 'Mist IDLE'}</p>
              </div>
            </div>

            {/* Hysteresis Logic Card */}
            <div className="p-5 bg-white/5 rounded-3xl border border-white/10 backdrop-blur-sm">
              <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest block mb-4">Humidity Logic</span>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-400 uppercase">Target</span>
                  <span className="text-xs font-mono text-sky-400">{setpoint?.toFixed(1) || '--'}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-400 uppercase">Trigger</span>
                  <span className="text-xs font-mono text-orange-400">{lowerBound?.toFixed(1) || '--'}%</span>
                </div>
                <div className="mt-4 pt-4 border-t border-white/5">
                  <p className="text-[10px] text-slate-500 leading-relaxed italic">
                    {needsMoisture 
                      ? "Low humidity: Misting initiated." 
                      : isInHysteresisZone 
                        ? "Buffer zone: Maintaining RH levels." 
                        : "Optimal RH reached: System idle."}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <button 
                onClick={openConfigModal}
                className="w-full text-left p-4 bg-slate-850/50 hover:bg-slate-800 border border-white/5 hover:border-sky-500/30 rounded-2xl transition-all duration-300 group cursor-pointer block"
              >
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-500 group-hover:text-sky-400 transition-colors uppercase font-bold tracking-widest block opacity-50">SetPoint</span>
                  <Settings className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 group-hover:rotate-45 transition-all duration-300" />
                </div>
                <p className="text-xl font-mono text-white/90 mt-1">{setpoint !== null ? setpoint.toFixed(2) : '0.00'}%</p>
              </button>
              
              <button 
                onClick={openConfigModal}
                className="w-full text-left p-4 bg-slate-850/50 hover:bg-slate-800 border border-white/5 hover:border-orange-500/30 rounded-2xl transition-all duration-300 group cursor-pointer block"
              >
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-500 group-hover:text-orange-400 transition-colors uppercase font-bold tracking-widest block opacity-50">Hysteresis</span>
                  <Settings className="w-3.5 h-3.5 text-slate-500 group-hover:text-orange-400 group-hover:rotate-45 transition-all duration-300" />
                </div>
                <p className="text-xl font-mono text-white/90 mt-1">{hysteresis !== null ? hysteresis.toFixed(2) : '0.00'}%</p>
              </button>
            </div>
          </div>

          <div 
            onClick={openConfigModal}
            className="p-6 bg-emerald-500 rounded-3xl text-slate-900 mt-8 relative z-10 group cursor-pointer hover:bg-emerald-400 transition-all border-b-4 border-emerald-700 active:border-b-0 active:translate-y-1"
          >
            <p className="font-black text-sm leading-tight text-center uppercase tracking-tighter">
              Fermentation Process<br />
              <span className="text-[10px] opacity-70 font-bold">Lock Protocol: Setpoint Settings</span>
            </p>
          </div>

          {/* Decorative mesh background */}
          <div className="absolute top-0 right-0 w-full h-full opacity-10 pointer-events-none">
            <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="white" strokeWidth="0.5"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
            </svg>
          </div>
        </div>

        {/* Chart Bento Card */}
        <div className="lg:col-span-9 lg:row-span-3 bento-card flex flex-col min-h-[400px]">
          <div className="flex justify-between items-center mb-10">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">Live Moisture Stream</span>
              <span className="text-[10px] text-slate-300 dark:text-slate-600 font-bold uppercase transition-colors duration-300">Humidity Hysteresis Visualization</span>
            </div>
            <div className="flex gap-6 items-center">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Current RH</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-0.5 bg-sky-300"></span>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Target %</span>
              </div>
            </div>
          </div>
          <div className="flex-1 -mx-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#1e293b' : '#f1f5f9'} vertical={false} />
                <XAxis 
                  dataKey="time" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 700}} 
                  minTickGap={40}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 700}}
                  domain={[
                    (dataMin: number) => Math.max(0, Math.min(dataMin, lowerBound || 60) - 5), 
                    (dataMax: number) => Math.min(100, Math.max(dataMax, setpoint || 90) + 5)
                  ]}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: theme === 'dark' ? '#0f172a' : '#1e293b',
                    border: 'none',
                    borderRadius: '16px',
                    color: '#fff',
                    padding: '12px',
                    fontFamily: 'JetBrains Mono'
                  }}
                />
                
                {setpoint !== null && lowerBound !== null && (
                  <ReferenceArea 
                    {...({
                      y1: lowerBound,
                      y2: setpoint,
                      fill: "#0ea5e9",
                      fillOpacity: theme === 'dark' ? 0.08 : 0.05,
                      label: { 
                        value: 'MOISTURE ZONE', 
                        position: 'insideBottomRight', 
                        fontSize: 9, 
                        fill: '#0ea5e9', 
                        fontWeight: 800,
                        opacity: 0.5
                      }
                    } as any)} 
                  />
                )}
                
                {setpoint !== null && (
                  <ReferenceLine 
                    y={setpoint} 
                    stroke="#0ea5e9" 
                    strokeDasharray="3 3" 
                    strokeOpacity={theme === 'dark' ? 0.45 : 0.3}
                    label={{ value: 'OFF', position: 'right', fontSize: 10, fill: '#0ea5e9', fontWeight: 700 }} 
                  />
                )}
                
                {lowerBound !== null && (
                  <ReferenceLine 
                    y={lowerBound} 
                    stroke="#f59e0b" 
                    strokeDasharray="3 3" 
                    strokeOpacity={theme === 'dark' ? 0.45 : 0.3}
                    label={{ value: 'ON', position: 'right', fontSize: 10, fill: '#f59e0b', fontWeight: 700 }} 
                  />
                )}

                <Line 
                  type="monotone" 
                  dataKey="humidity" 
                  stroke="#0ea5e9" 
                  strokeWidth={4} 
                  dot={{ r: 4, fill: '#0ea5e9', strokeWidth: 2, stroke: theme === 'dark' ? '#0f172a' : '#fff' }}
                  activeDot={{ r: 8 }}
                  isAnimationActive={true}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-between mt-6 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">
            <span>Moisture Cycle</span>
            <span>Live RH Telemetry</span>
          </div>
        </div>

      </main>

      <footer className="text-center py-12 flex flex-col items-center gap-4">
        <p className="text-[10px] font-black text-slate-300 dark:text-slate-800 uppercase tracking-[0.5em] transition-colors duration-300">
          PROTOCOL SECURED BY FAQIH2026 // SYSTEM STABLE
        </p>
        <div className="h-px w-12 bg-slate-200 dark:bg-slate-800 transition-colors duration-300" />
        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] flex items-center gap-2 transition-colors duration-300">
          Powered by <span className="text-slate-900 dark:text-slate-150 transition-colors duration-300">Konsultech</span>
        </p>
      </footer>

      {/* Secure Configuration Modal overlay */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Glassmorphic Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-md cursor-pointer"
            />

            {/* Modal Card content */}
            <motion.div
              layout
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={shouldShake 
                ? { scale: 1, opacity: 1, y: 0, x: [-10, 10, -10, 10, 0], transition: { duration: 0.4 } } 
                : { scale: 1, opacity: 1, y: 0 }
              }
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ type: "spring", duration: 0.5 }}
              className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-8 shadow-2xl overflow-hidden text-slate-900 dark:text-slate-100 z-10 transition-colors duration-300"
            >
              {isSuccess ? (
                // Success State View
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center justify-center py-10"
                >
                  <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-950/50 rounded-full flex items-center justify-center mb-6">
                    <Check className="w-10 h-10 text-emerald-500" />
                  </div>
                  <h3 className="text-xl font-bold text-center tracking-tight text-slate-900 dark:text-slate-50">
                    AUTHORIZATION APPROVED
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 text-center mt-2 font-medium">
                    Parameters applied and published to broker successfully.
                  </p>
                </motion.div>
              ) : (
                // Input Form State View
                <form onSubmit={handleSubmitSettings} className="space-y-6">
                  {/* Lock/Access Indicator Head */}
                  <div className="flex items-center gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
                    <div className="w-12 h-12 bg-red-100/70 dark:bg-red-950/40 rounded-2xl flex items-center justify-center animate-pulse">
                      <Lock className="w-5 h-5 text-red-500" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50">
                        Secure Threshold Config
                      </h3>
                      <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold tracking-wider uppercase mt-0.5">
                        FAQIH2026 High Capacity System
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Setpoint Field */}
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                        Target Setpoint (Humidity RH %)
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          required
                          value={tempSetpoint}
                          onChange={(e) => setTempSetpoint(e.target.value)}
                          className="w-full px-5 py-3 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 font-mono text-sm tracking-wide text-slate-900 dark:text-slate-100 transition-colors"
                          placeholder="e.g. 80.0"
                        />
                        <span className="absolute right-5 top-1/2 -translate-y-1/2 opacity-40 text-xs font-bold font-mono">% RH</span>
                      </div>
                    </div>

                    {/* Hysteresis Field */}
                    <div className="flex flex-col gap-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                        Hysteresis Tolerance Range (%)
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          max="20"
                          required
                          value={tempHysteresis}
                          onChange={(e) => setTempHysteresis(e.target.value)}
                          className="w-full px-5 py-3 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 font-mono text-sm tracking-wide text-slate-900 dark:text-slate-100 transition-colors"
                          placeholder="e.g. 2.0"
                        />
                        <span className="absolute right-5 top-1/2 -translate-y-1/2 opacity-40 text-xs font-bold font-mono">± %</span>
                      </div>
                    </div>

                    {/* Security Passcode Field */}
                    <div className="flex flex-col gap-2 pt-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                          Security Passcode
                        </label>
                        <span className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 opacity-60">
                          Default: <span className="font-mono bg-slate-150 dark:bg-slate-800 px-1 py-0.5 rounded text-[8px] opacity-100">faqih2026</span>
                        </span>
                      </div>
                      <div className="relative">
                        <input
                          type={showPassword ? "text" : "password"}
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full pl-5 pr-12 py-3 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 font-mono text-sm tracking-wide text-slate-900 dark:text-slate-100 transition-colors"
                          placeholder="Enter system protocol key"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400 transition-colors cursor-pointer"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {passError && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2.5 text-xs text-red-500 font-semibold"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{passError}</span>
                    </motion.div>
                  )}

                  {/* Submit / Action Buttons */}
                  <div className="flex gap-3 pt-4 border-t border-slate-100 dark:border-slate-800 mt-6">
                    <button
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      disabled={isVerifying}
                      className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl text-xs font-bold uppercase tracking-widest transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isVerifying}
                      className="flex-1 py-3 bg-red-500 hover:bg-red-600 active:translate-y-0.5 text-white rounded-2xl text-xs font-bold uppercase tracking-widest transition-all cursor-pointer shadow-lg shadow-red-500/20 disabled:scale-100 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isVerifying ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                          <span>Verifying...</span>
                        </>
                      ) : (
                        <>
                          <Unlock className="w-3.5 h-3.5" />
                          <span>Apply Settings</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}


function StatCard({ label, value, unit, icon, accent, isStatus }: { 
  label: string; 
  value: string | number; 
  unit?: string; 
  icon: React.ReactNode;
  accent: string;
  isStatus?: boolean;
}) {
  const accentColors: any = {
    orange: 'text-orange-600',
    blue: 'text-blue-600',
    emerald: 'text-emerald-600',
    red: 'text-red-600',
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bento-card rounded-2xl group relative overflow-hidden"
    >
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-4 opacity-50 font-mono text-[10px] uppercase tracking-widest">
          {icon}
          <span>{label}</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className={cn(
            "text-4xl font-light tracking-tight transition-colors duration-500",
            isStatus ? (value === 'ON' ? 'text-emerald-500' : 'text-orange-500') : "text-slate-900 dark:text-slate-100"
          )}>
            {value}
          </span>
          {unit && <span className="text-xl font-light opacity-30">{unit}</span>}
        </div>
      </div>
      
      {/* Subtle indicator beam */}
      <div className={cn(
        "absolute bottom-0 left-0 h-1 transition-all duration-500",
        value !== '--.-' ? "w-full" : "w-0",
        accent === 'orange' && "bg-orange-500",
        accent === 'blue' && "bg-blue-500",
        accent === 'emerald' && "bg-emerald-500",
        accent === 'red' && "bg-red-500",
      )} />
    </motion.div>
  );
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center border-b border-[var(--color-line)] pb-3">
      <span className="text-xs opacity-50">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

