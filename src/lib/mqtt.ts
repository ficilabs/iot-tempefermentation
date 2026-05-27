
import mqtt from 'mqtt';

const BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';

export const topics = {
  humidity: "faqih2026/humidity",
  temperature: "faqih2026/temperature",
  status: "faqih2026/status",
  pressure: "faqih2026/pressure",
  setpointSub: "faqih2026/setpoint",
  hysteresisSub: "faqih2026/hysteresis",
  setpointPub: "faqih2026/control/setpoint",
  hysteresisPub: "faqih2026/control/hysteresis",
};

export const createMqttClient = () => {
  const client = mqtt.connect(BROKER_URL, {
    clientId: 'tempeh_web_' + Math.random().toString(16).substring(2, 10),
    keepalive: 30,
    reconnectPeriod: 2000,
    connectTimeout: 30 * 1000,
    clean: true,
    path: '/mqtt' // Essential for many WebSocket brokers
  });

  return client;
};
