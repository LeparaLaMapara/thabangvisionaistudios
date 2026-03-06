'use client';

import { useState, useMemo, useEffect, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Calculator,
  Camera,
  HardDrive,
  Zap,
  Eye,
  ArrowLeft,
  Plus,
  Trash2,
  ChevronRight,
  Maximize2,
  Aperture,
  Box,
  Scale,
  Table2,
  Combine,
  ArrowRightLeft,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Banknote,
  MapPin,
  Sun,
  Wind,
  Cloud,
  FileText
} from 'lucide-react';

// --- DATA CONSTANTS ---

const SENSOR_PRESETS = [
  { id: 'alexa65', name: 'ARRI Alexa 65', width: 54.12, height: 25.58, crop: 0.7, coc: 0.043 },
  { id: 'vv', name: 'RED Monstro VV', width: 40.96, height: 21.60, crop: 0.8, coc: 0.035 },
  { id: 'ff', name: 'Full Frame (36x24)', width: 36, height: 24, crop: 1.0, coc: 0.030 },
  { id: 's35', name: 'Super 35 (ARRI)', width: 27.99, height: 19.22, crop: 1.5, coc: 0.020 },
  { id: 'm43', name: 'Micro 4/3', width: 17.3, height: 13, crop: 2.0, coc: 0.015 },
];

const LIGHTING_FIXTURES = [
  { id: 'm90', name: 'ARRI M90 HMI', watts: 9000, type: 'HMI' },
  { id: 'm40', name: 'ARRI M40 HMI', watts: 4000, type: 'HMI' },
  { id: 'm18', name: 'ARRI M18 HMI', watts: 1800, type: 'HMI' },
  { id: 's360', name: 'ARRI SkyPanel S360', watts: 1500, type: 'LED' },
  { id: 's60', name: 'ARRI SkyPanel S60', watts: 420, type: 'LED' },
  { id: 'vortex8', name: 'Creamsource Vortex8', watts: 650, type: 'LED' },
  { id: '600d', name: 'Aputure 600d Pro', watts: 720, type: 'LED' },
  { id: 'titan', name: 'Astera Titan (Set of 8)', watts: 400, type: 'LED' },
];

const RECORDING_FORMATS = [
  { id: 'arriraw_og', name: 'ARRIRAW Open Gate 4.6K', dataRateMBs: 320 },
  { id: 'redcode_51', name: 'REDCODE RAW 8K 5:1', dataRateMBs: 260 },
  { id: 'prores_4444xq', name: 'ProRes 4444 XQ UHD', dataRateMBs: 210 },
  { id: 'prores_4444', name: 'ProRes 4444 UHD', dataRateMBs: 140 },
  { id: 'prores_422', name: 'ProRes 422 HQ UHD', dataRateMBs: 95 },
  { id: 'h265_high', name: 'H.265 / HEVC 10-bit', dataRateMBs: 25 },
];

const LENSES_DB = [
  { id: 'arri_sig_47', brand: 'ARRI', name: 'Signature Prime 47mm', tStop: 'T1.8', closeFocus: '0.46m', frontDia: '114mm', weight: '1.8 kg', mount: 'LPL', coverage: 'Large Format' },
  { id: 'cooke_s7_50', brand: 'Cooke', name: 'S7/i 50mm', tStop: 'T2.0', closeFocus: '0.61m', frontDia: '110mm', weight: '2.4 kg', mount: 'PL', coverage: 'Full Frame Plus' },
  { id: 'zeiss_sup_50', brand: 'Zeiss', name: 'Supreme Prime 50mm', tStop: 'T1.5', closeFocus: '0.46m', frontDia: '95mm', weight: '1.2 kg', mount: 'PL', coverage: 'Full Frame' },
  { id: 'atlas_orion_50', brand: 'Atlas', name: 'Orion 50mm (2x)', tStop: 'T2.0', closeFocus: '0.76m', frontDia: '114mm', weight: '2.3 kg', mount: 'PL', coverage: 'Super 35' },
  { id: 'angenieux_opt_12', brand: 'Angenieux', name: 'Optimo Ultra 12x', tStop: 'T2.8', closeFocus: '1.22m', frontDia: '162mm', weight: '12.6 kg', mount: 'PL', coverage: 'Multi-Format' },
];

const CAMERAS_DB = [
  { id: 'alexa_35', brand: 'ARRI', name: 'Alexa 35', sensor: 'S35 (28x19mm)', res: '4.6K', dr: '17 Stops', mount: 'LPL', media: 'Codex Compact', weight: '2.9 kg' },
  { id: 'venice_2', brand: 'Sony', name: 'Venice 2 8K', sensor: 'FF (36x24mm)', res: '8.6K', dr: '16 Stops', mount: 'PL/E', media: 'AXS A-Series', weight: '4.2 kg' },
  { id: 'v_raptor', brand: 'RED', name: 'V-Raptor XL', sensor: 'VV (41x21mm)', res: '8K', dr: '17+ Stops', mount: 'PL (RF Native)', media: 'CFexpress B', weight: '3.6 kg' },
  { id: 'ursa_12k', brand: 'Blackmagic', name: 'URSA Mini Pro 12K', sensor: 'S35 (27x14mm)', res: '12K', dr: '14 Stops', mount: 'PL', media: 'CFast 2.0 / SSD', weight: '2.5 kg' },
  { id: 'alexa_mini_lf', brand: 'ARRI', name: 'Alexa Mini LF', sensor: 'LF (36x25mm)', res: '4.5K', dr: '14.5 Stops', mount: 'LPL', media: 'Codex Compact', weight: '2.6 kg' },
];

const MOUNT_TYPES = [
  { id: 'pl', name: 'PL Mount', flange: 52.00 },
  { id: 'lpl', name: 'LPL Mount', flange: 44.00 },
  { id: 'ef', name: 'EF Mount', flange: 44.00 },
  { id: 'rf', name: 'RF Mount (RED/Canon)', flange: 20.00 },
  { id: 'e', name: 'E Mount (Sony)', flange: 18.00 },
  { id: 'pv', name: 'PV Mount (Panavision)', flange: 57.15 },
  { id: 'xpl', name: 'XPL (Alexa 65)', flange: 60.00 },
];

// --- HELPER COMPONENTS ---

const ToolCard = ({
  title,
  description,
  icon: Icon,
  onClick,
  delay
}: {
  title: string;
  description: string;
  icon: any;
  onClick: () => void;
  delay: number;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    onClick={onClick}
    className="group relative bg-white dark:bg-[#0A0A0B] border border-black/10 dark:border-white/10 p-8 cursor-pointer overflow-hidden hover:border-black/30 dark:hover:border-white/30 transition-all duration-300 h-full flex flex-col"
  >
    <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
      <Icon className="w-24 h-24 text-black dark:text-white transform group-hover:scale-110 transition-transform duration-700" />
    </div>

    <div className="relative z-10 flex flex-col h-full justify-between">
      <div>
         <div className="w-10 h-10 border border-black/10 dark:border-white/10 flex items-center justify-center mb-6 bg-neutral-50 dark:bg-white/5 text-black dark:text-white">
            <Icon className="w-5 h-5" />
         </div>
         <h3 className="text-lg font-display font-medium text-black dark:text-white uppercase mb-2 group-hover:underline decoration-1 underline-offset-4">{title}</h3>
         <p className="text-xs text-neutral-500 font-light leading-relaxed mb-6">{description}</p>
      </div>

      <div className="flex items-center gap-2 text-[9px] font-mono font-bold tracking-widest text-black dark:text-white uppercase">
         Launch Tool <ChevronRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
      </div>
    </div>
  </motion.div>
);

const RangeInput = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit = ''
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
  unit?: string;
}) => (
  <div className="mb-6">
    <div className="flex justify-between items-end mb-3">
      <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">{label}</label>
      <span className="font-mono text-sm text-black dark:text-white">{value}{unit}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-1 bg-neutral-200 dark:bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-black dark:accent-white focus:outline-none"
    />
  </div>
);

// --- CALCULATORS ---

const FOVCalculator = () => {
  const [focalLength, setFocalLength] = useState(35);
  const [sensorId, setSensorId] = useState('s35');
  const [distance, setDistance] = useState(3);

  const sensor = SENSOR_PRESETS.find(s => s.id === sensorId) || SENSOR_PRESETS[2];

  const hAOV = (2 * Math.atan(sensor.width / (2 * focalLength))) * (180 / Math.PI);
  const vAOV = (2 * Math.atan(sensor.height / (2 * focalLength))) * (180 / Math.PI);

  const fieldWidth = 2 * (Math.tan((hAOV * Math.PI) / 360) * distance);
  const fieldHeight = 2 * (Math.tan((vAOV * Math.PI) / 360) * distance);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
      <div className="lg:col-span-4 space-y-8">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-3 text-neutral-500">Sensor Format</label>
          <select
            value={sensorId}
            onChange={(e) => setSensorId(e.target.value)}
            className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white p-3 text-sm focus:border-black dark:focus:border-white outline-none font-mono"
          >
            {SENSOR_PRESETS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <RangeInput label="Focal Length" value={focalLength} min={12} max={200} onChange={setFocalLength} unit="mm" />
        <RangeInput label="Subject Distance" value={distance} min={1} max={50} onChange={setDistance} unit="m" />

        <div className="bg-neutral-100 dark:bg-neutral-900 p-6 border border-black/5 dark:border-white/5">
           <h4 className="text-[10px] font-bold uppercase tracking-widest mb-4 text-black dark:text-white">Format Equivalents (FOV Match)</h4>
           <div className="space-y-3">
             {SENSOR_PRESETS.filter(s => s.id !== sensorId).map(s => {
               const equiv = Math.round(focalLength * (s.width / sensor.width));
               return (
                 <div key={s.id} className="flex justify-between text-xs font-mono">
                   <span className="text-neutral-500">{s.name.split('(')[0]}</span>
                   <span className="text-black dark:text-white">{equiv}mm</span>
                 </div>
               )
             })}
           </div>
        </div>
      </div>

      <div className="lg:col-span-8 bg-neutral-100 dark:bg-neutral-900/50 border border-black/5 dark:border-white/5 relative min-h-[500px] flex items-center justify-center p-8 overflow-hidden">
         <div className="absolute top-4 left-4 text-[10px] tracking-widest uppercase text-neutral-500">Visualization</div>

         <div className="relative z-10 w-full max-w-lg aspect-square flex flex-col items-center justify-end">
            <div className="w-12 h-8 bg-black dark:bg-white rounded-sm mb-1 relative z-20">
               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-neutral-500 rounded-full" />
            </div>

            <motion.div
               className="origin-bottom bg-gradient-to-t from-black/10 to-transparent dark:from-white/10 dark:to-transparent border-l border-r border-black/20 dark:border-white/20"
               animate={{
                  height: '400px',
                  width: `${Math.min(600, Math.tan((hAOV * Math.PI) / 360) * 800)}px`
               }}
               transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
            >
               <div className="w-full border-t border-dashed border-black/30 dark:border-white/30 absolute top-0 left-0 flex justify-center">
                 <span className="bg-neutral-100 dark:bg-[#111] px-2 text-[9px] font-mono -mt-2.5 text-neutral-500">{distance}m</span>
               </div>
            </motion.div>
         </div>

         <div className="absolute bottom-4 left-4 right-4 grid grid-cols-2 gap-4">
             <div className="bg-white dark:bg-black p-4 border border-black/10 dark:border-white/10">
                <div className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1">Field Width</div>
                <div className="text-xl font-mono text-black dark:text-white">{fieldWidth.toFixed(1)} m</div>
             </div>
             <div className="bg-white dark:bg-black p-4 border border-black/10 dark:border-white/10">
                <div className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1">Horizontal Angle</div>
                <div className="text-xl font-mono text-black dark:text-white">{hAOV.toFixed(1)}°</div>
             </div>
         </div>
      </div>
    </div>
  );
};

const DOFCalculator = () => {
  const [focalLength, setFocalLength] = useState(50);
  const [aperture, setAperture] = useState(2.8);
  const [focusDist, setFocusDist] = useState(3);
  const [sensorId, setSensorId] = useState('s35');

  const sensor = SENSOR_PRESETS.find(s => s.id === sensorId) || SENSOR_PRESETS[2];

  const f = focalLength;
  const N = aperture;
  const c = sensor.coc;
  const s = focusDist * 1000;

  const H = (f * f) / (N * c);

  const nearLimit = (H * s) / (H + (s - f));
  let farLimit = (H * s) / (H - (s - f));

  if (s >= H || (H - (s-f)) <= 0) {
    farLimit = Infinity;
  }

  const dofTotal = farLimit === Infinity ? Infinity : farLimit - nearLimit;

  const mmToM = (mm: number) => (mm / 1000).toFixed(2);
  const fmtDist = (mm: number) => mm === Infinity ? '∞' : `${mmToM(mm)}m`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
      <div className="lg:col-span-4 space-y-8">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-3 text-neutral-500">Sensor Format</label>
          <select
            value={sensorId}
            onChange={(e) => setSensorId(e.target.value)}
            className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white p-3 text-sm focus:border-black dark:focus:border-white outline-none font-mono"
          >
            {SENSOR_PRESETS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <RangeInput label="Focal Length" value={focalLength} min={14} max={135} onChange={setFocalLength} unit="mm" />
        <RangeInput label="Aperture (T-Stop)" value={aperture} min={1.0} max={22} step={0.1} onChange={setAperture} unit="" />
        <RangeInput label="Focus Distance" value={focusDist} min={0.5} max={50} onChange={setFocusDist} unit="m" />

        <div className="bg-neutral-100 dark:bg-neutral-900 p-6 border border-black/5 dark:border-white/5">
           <h4 className="text-[10px] font-bold uppercase tracking-widest mb-4 text-black dark:text-white">Hyperfocal Distance</h4>
           <div className="text-3xl font-mono text-black dark:text-white mb-1">
             {mmToM(H)}m
           </div>
           <p className="text-[10px] text-neutral-500">Focus here to keep everything from {(mmToM(H/2))}m to Infinity in acceptable sharpness.</p>
        </div>
      </div>

      <div className="lg:col-span-8 flex flex-col justify-center space-y-8">
         <div className="relative h-48 bg-neutral-100 dark:bg-neutral-900/50 border-x border-black/10 dark:border-white/10 overflow-hidden flex items-center">
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-blue-500 z-30" />
            <div className="absolute left-1/2 top-4 -translate-x-1/2 text-[9px] font-mono text-blue-500 uppercase tracking-widest bg-white dark:bg-black px-1">Focus Plane</div>

            <motion.div
               className="h-24 bg-black/10 dark:bg-white/10 absolute top-1/2 -translate-y-1/2 z-20"
               animate={{
                  left: '20%',
                  right: farLimit === Infinity ? '0%' : '20%'
               }}
            />

            <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-white dark:from-[#0A0A0B] to-transparent z-40" />
         </div>

         <div className="grid grid-cols-3 gap-4">
            <div className="p-6 border border-black/10 dark:border-white/10 text-center">
               <div className="text-[9px] uppercase tracking-widest text-neutral-500 mb-2">Near Limit</div>
               <div className="text-xl font-mono font-bold text-black dark:text-white">{fmtDist(nearLimit)}</div>
            </div>
            <div className="p-6 border border-black/10 dark:border-white/10 text-center bg-black dark:bg-white text-white dark:text-black">
               <div className="text-[9px] uppercase tracking-widest opacity-70 mb-2">Total Depth</div>
               <div className="text-xl font-mono font-bold">{fmtDist(dofTotal)}</div>
            </div>
            <div className="p-6 border border-black/10 dark:border-white/10 text-center">
               <div className="text-[9px] uppercase tracking-widest text-neutral-500 mb-2">Far Limit</div>
               <div className="text-xl font-mono font-bold text-black dark:text-white">{fmtDist(farLimit)}</div>
            </div>
         </div>
      </div>
    </div>
  );
};

const PowerCalculator = () => {
  const [items, setItems] = useState<{fixtureId: string, quantity: number}[]>([]);
  const [selectedFixture, setSelectedFixture] = useState(LIGHTING_FIXTURES[0].id);

  const addFixture = () => {
    const existing = items.find(i => i.fixtureId === selectedFixture);
    if (existing) {
      setItems(items.map(i => i.fixtureId === selectedFixture ? {...i, quantity: i.quantity + 1} : i));
    } else {
      setItems([...items, { fixtureId: selectedFixture, quantity: 1 }]);
    }
  };

  const removeItem = (id: string) => {
    setItems(items.filter(i => i.fixtureId !== id));
  };

  const totalWatts = items.reduce((sum, item) => {
    const fixture = LIGHTING_FIXTURES.find(f => f.id === item.fixtureId);
    return sum + (fixture ? fixture.watts * item.quantity : 0);
  }, 0);

  const totalAmps120 = totalWatts / 120;
  const totalAmps230 = totalWatts / 230;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
      <div className="lg:col-span-5 space-y-8">
         <div className="bg-neutral-100 dark:bg-neutral-900 p-8 border border-black/5 dark:border-white/5">
            <h3 className="text-sm font-bold uppercase tracking-widest text-black dark:text-white mb-6">Add Fixtures</h3>
            <div className="flex gap-2 mb-6">
               <select
                 className="flex-grow bg-white dark:bg-black border border-black/10 dark:border-white/10 p-3 text-sm outline-none"
                 value={selectedFixture}
                 onChange={(e) => setSelectedFixture(e.target.value)}
               >
                 {LIGHTING_FIXTURES.map(f => (
                   <option key={f.id} value={f.id}>{f.name} ({f.watts}W)</option>
                 ))}
               </select>
               <button
                 onClick={addFixture}
                 className="bg-black dark:bg-white text-white dark:text-black p-3 hover:opacity-80 transition-opacity"
               >
                 <Plus className="w-5 h-5" />
               </button>
            </div>

            <div className="space-y-1 max-h-[300px] overflow-y-auto">
               {items.length === 0 && <p className="text-xs text-neutral-500 italic">No fixtures added.</p>}
               {items.map(item => {
                 const fixture = LIGHTING_FIXTURES.find(f => f.id === item.fixtureId);
                 if (!fixture) return null;
                 return (
                   <div key={item.fixtureId} className="flex justify-between items-center bg-white dark:bg-black p-3 border border-black/5 dark:border-white/5">
                      <div>
                        <div className="text-xs font-bold text-black dark:text-white">{fixture.name}</div>
                        <div className="text-[10px] text-neutral-500">{fixture.watts}W x {item.quantity} = {fixture.watts * item.quantity}W</div>
                      </div>
                      <button onClick={() => removeItem(item.fixtureId)} className="text-neutral-400 hover:text-red-500 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                   </div>
                 )
               })}
            </div>
         </div>
      </div>

      <div className="lg:col-span-7">
         <div className="bg-black dark:bg-white text-white dark:text-black p-10 h-full flex flex-col justify-center items-center text-center relative overflow-hidden">
            <Zap className="absolute text-white/5 dark:text-black/5 w-64 h-64 -right-12 -bottom-12 rotate-12" />

            <div className="relative z-10 space-y-8 w-full max-w-md">
               <div>
                  <div className="text-xs font-mono uppercase tracking-widest opacity-60 mb-2">Total Load</div>
                  <div className="text-6xl font-display font-medium">{totalWatts.toLocaleString()}<span className="text-2xl ml-1">W</span></div>
               </div>

               <div className="grid grid-cols-2 gap-8 border-t border-white/20 dark:border-black/20 pt-8">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest opacity-60 mb-1">Amps @ 120V</div>
                    <div className="text-3xl font-mono">{totalAmps120.toFixed(1)}A</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest opacity-60 mb-1">Amps @ 230V</div>
                    <div className="text-3xl font-mono">{totalAmps230.toFixed(1)}A</div>
                  </div>
               </div>

               <div className="pt-4">
                  {totalAmps230 > 63 ? (
                     <div className="text-xs bg-red-500/20 border border-red-500 text-red-200 px-4 py-2 inline-block">
                        ⚠️ Generator Required (Over 63A Household Limit)
                     </div>
                  ) : (
                     <div className="text-xs bg-green-500/20 border border-green-500 text-green-200 dark:text-green-800 px-4 py-2 inline-block">
                        ✓ Standard 3-Phase or High-Amp Household
                     </div>
                  )}
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

const StorageCalculator = () => {
  const [formatId, setFormatId] = useState(RECORDING_FORMATS[0].id);
  const [framerate, setFramerate] = useState(24);
  const [cameras, setCameras] = useState(1);
  const [duration, setDuration] = useState(5);

  const format = RECORDING_FORMATS.find(f => f.id === formatId) || RECORDING_FORMATS[0];

  const totalMB = format.dataRateMBs * (framerate/24) * 60 * 60 * duration * cameras;
  const totalTB = totalMB / 1000000;

  return (
     <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
      <div className="lg:col-span-4 space-y-8">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-3 text-neutral-500">Camera Codec</label>
          <select
            value={formatId}
            onChange={(e) => setFormatId(e.target.value)}
            className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white p-3 text-sm focus:border-black dark:focus:border-white outline-none font-mono"
          >
            {RECORDING_FORMATS.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>

        <RangeInput label="Frame Rate" value={framerate} min={24} max={120} onChange={setFramerate} unit="fps" />
        <RangeInput label="Cameras" value={cameras} min={1} max={6} onChange={setCameras} unit="" />
        <RangeInput label="Shoot Duration" value={duration} min={1} max={24} onChange={setDuration} unit="hrs" />
      </div>

      <div className="lg:col-span-8">
         <div className="bg-neutral-100 dark:bg-neutral-900 border border-black/5 dark:border-white/5 h-full p-10 flex flex-col justify-center items-center text-center">
            <div className="mb-8">
               <HardDrive className="w-16 h-16 text-black dark:text-white mx-auto mb-4" />
               <h3 className="text-3xl font-display font-medium text-black dark:text-white">Estimated Storage</h3>
            </div>

            <div className="grid grid-cols-2 gap-12 w-full max-w-lg">
               <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">Total Capacity</div>
                  <div className="text-5xl font-mono font-bold text-black dark:text-white">{totalTB.toFixed(2)}<span className="text-xl ml-1">TB</span></div>
               </div>
               <div>
                  <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">Data Rate</div>
                  <div className="text-5xl font-mono font-bold text-black dark:text-white">{(format.dataRateMBs * (framerate/24)).toFixed(0)}<span className="text-xl ml-1">MB/s</span></div>
               </div>
            </div>

            <div className="mt-12 w-full max-w-md bg-white dark:bg-black p-4 border border-black/10 dark:border-white/10 text-left">
               <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-2">Recommended Media</div>
               <div className="text-sm font-bold text-black dark:text-white">
                 {totalTB > 2 ? '4TB NVMe RAID Shuttle or 8TB HDD Array' : '2TB Portable NVMe SSD'}
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

const BudgetEstimator = () => {
   const [days, setDays] = useState(1);
   const [camera, setCamera] = useState(25000);
   const [lighting, setLighting] = useState(15000);
   const [crew, setCrew] = useState(15000);

   const total = (camera + lighting + crew) * days;

   return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
         <div className="lg:col-span-5 space-y-6">
            <div>
               <label className="block text-[10px] font-bold uppercase tracking-widest mb-3 text-neutral-500">Shoot Duration (Days)</label>
               <input
                  type="number" min="1" max="60" value={days} onChange={e => setDays(Number(e.target.value))}
                  className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-3 text-sm"
               />
            </div>
            <div>
               <label className="block text-[10px] font-bold uppercase tracking-widest mb-3 text-neutral-500">Camera Package</label>
               <select
                  className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-3 text-sm"
                  value={camera} onChange={e => setCamera(Number(e.target.value))}
               >
                  <option value={18000}>Red Raptor Package (R18k/day)</option>
                  <option value={22000}>Sony Venice 2 Package (R22k/day)</option>
                  <option value={25000}>Arri Alexa 35 Package (R25k/day)</option>
               </select>
            </div>
            <div>
               <label className="block text-[10px] font-bold uppercase tracking-widest mb-3 text-neutral-500">Lighting & Grip</label>
               <select
                  className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-3 text-sm"
                  value={lighting} onChange={e => setLighting(Number(e.target.value))}
               >
                  <option value={15000}>Van Package (R15k/day)</option>
                  <option value={35000}>3-Ton Truck (R35k/day)</option>
                  <option value={80000}>Stadium/Large Scale (R80k/day)</option>
               </select>
            </div>
            <div>
               <label className="block text-[10px] font-bold uppercase tracking-widest mb-3 text-neutral-500">Crew Size</label>
               <select
                  className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-3 text-sm"
                  value={crew} onChange={e => setCrew(Number(e.target.value))}
               >
                  <option value={15000}>Skeleton Crew (5 Pax)</option>
                  <option value={45000}>Standard Commercial (15 Pax)</option>
                  <option value={85000}>Feature Unit (40+ Pax)</option>
               </select>
            </div>
         </div>

         <div className="lg:col-span-7 flex flex-col items-center justify-center bg-black dark:bg-white text-white dark:text-black p-10 text-center relative overflow-hidden">
             <Banknote className="absolute -bottom-10 -right-10 w-64 h-64 opacity-5 rotate-12" />
             <div className="relative z-10">
               <div className="text-[10px] font-mono uppercase tracking-widest opacity-60 mb-4">Estimated Total</div>
               <div className="text-5xl md:text-7xl font-display font-medium mb-8">
                  R{total.toLocaleString()}
               </div>
               <Link href="/contact" className="inline-block border border-white/20 dark:border-black/20 px-8 py-3 text-xs font-mono font-bold uppercase tracking-widest hover:bg-white hover:text-black dark:hover:bg-black dark:hover:text-white transition-colors">
                  Request Custom Quote
               </Link>
             </div>
         </div>
      </div>
   )
}

const LocationScout = () => {
   const [selectedLoc, setSelectedLoc] = useState('soweto');
   const locations = {
      soweto: { name: 'Soweto - Orlando Towers', temp: '24°C', cond: 'Sunny', wind: '12km/h', img: 'https://images.unsplash.com/photo-1577083288073-40892c0860a4?q=80&w=2000&auto=format&fit=crop' },
      maboneng: { name: 'Maboneng Precinct', temp: '22°C', cond: 'Cloudy', wind: '8km/h', img: 'https://images.unsplash.com/photo-1550948396-9ee82b13c77d?q=80&w=2000&auto=format&fit=crop' },
      sandton: { name: 'Sandton Central', temp: '25°C', cond: 'Clear', wind: '5km/h', img: 'https://images.unsplash.com/photo-1576487248805-cf45f6bcc67f?q=80&w=2000&auto=format&fit=crop' },
      braam: { name: 'Braamfontein - Mandela Bridge', temp: '23°C', cond: 'Partly Cloudy', wind: '15km/h', img: 'https://images.unsplash.com/photo-1534270804882-6b5048b1c1fc?q=80&w=2000&auto=format&fit=crop' }
   };

   const loc = locations[selectedLoc as keyof typeof locations];

   return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-full">
         <div className="space-y-6">
            <div>
               <label className="block text-[10px] font-bold uppercase tracking-widest mb-3 text-neutral-500">Select Location</label>
               <select
                  className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-3 text-sm"
                  value={selectedLoc} onChange={e => setSelectedLoc(e.target.value)}
               >
                  <option value="soweto">Soweto - Orlando Towers</option>
                  <option value="maboneng">Maboneng Precinct</option>
                  <option value="sandton">Sandton Central</option>
                  <option value="braam">Braamfontein</option>
               </select>
            </div>

            <div className="bg-neutral-100 dark:bg-neutral-900 p-6 border border-black/5 dark:border-white/5">
               <div className="flex items-center gap-2 mb-4">
                  <FileText className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-widest">Permit Requirements</span>
               </div>
               <p className="text-xs text-neutral-500 mb-4">Commercial shoots in {loc.name} require a JOC permit filed 14 days in advance.</p>
               <a href="#" className="text-[10px] font-mono font-bold underline decoration-1 underline-offset-4 hover:text-neutral-500">
                  Download City of Joburg Permit Forms
               </a>
            </div>

            <div className="grid grid-cols-3 gap-4">
               <div className="bg-blue-50 dark:bg-blue-900/20 p-4 border border-blue-100 dark:border-blue-900/30 text-center">
                  <Sun className="w-6 h-6 mx-auto mb-2 text-blue-500" />
                  <div className="text-sm font-bold">{loc.temp}</div>
               </div>
               <div className="bg-neutral-50 dark:bg-neutral-800 p-4 border border-neutral-100 dark:border-neutral-700 text-center">
                  <Cloud className="w-6 h-6 mx-auto mb-2 text-neutral-500" />
                  <div className="text-sm font-bold">{loc.cond}</div>
               </div>
               <div className="bg-neutral-50 dark:bg-neutral-800 p-4 border border-neutral-100 dark:border-neutral-700 text-center">
                  <Wind className="w-6 h-6 mx-auto mb-2 text-neutral-500" />
                  <div className="text-sm font-bold">{loc.wind}</div>
               </div>
            </div>
         </div>

         <div className="relative h-64 lg:h-auto bg-neutral-200 dark:bg-neutral-900 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={loc.img} alt={loc.name} className="w-full h-full object-cover grayscale opacity-80" />
            <div className="absolute inset-0 flex items-center justify-center">
               <div className="bg-black/50 backdrop-blur-md px-4 py-2 text-white text-xs font-mono uppercase tracking-widest border border-white/20">
                  <MapPin className="w-3 h-3 inline mr-2" /> Live View
               </div>
            </div>
         </div>
      </div>
   )
}

const LensComparator = () => {
  const [selectedLenses, setSelectedLenses] = useState<string[]>([LENSES_DB[0].id, LENSES_DB[1].id]);

  const toggleLens = (id: string) => {
    if (selectedLenses.includes(id)) {
      setSelectedLenses(selectedLenses.filter(lid => lid !== id));
    } else {
      if (selectedLenses.length < 3) {
        setSelectedLenses([...selectedLenses, id]);
      }
    }
  };

  return (
    <div className="space-y-8">
       <div className="bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-6">
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-4 text-neutral-500">Select Lenses to Compare (Max 3)</label>
          <div className="flex flex-wrap gap-2">
             {LENSES_DB.map(lens => (
               <button
                 key={lens.id}
                 onClick={() => toggleLens(lens.id)}
                 className={`px-4 py-2 text-xs font-mono border transition-all ${
                   selectedLenses.includes(lens.id)
                    ? 'bg-black text-white dark:bg-white dark:text-black border-transparent'
                    : 'bg-transparent text-neutral-600 dark:text-neutral-400 border-black/20 dark:border-white/20 hover:border-black dark:hover:border-white'
                 }`}
               >
                 {lens.brand} {lens.name}
               </button>
             ))}
          </div>
       </div>

       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {selectedLenses.map(id => {
             const lens = LENSES_DB.find(l => l.id === id);
             if(!lens) return null;
             return (
                <motion.div
                  key={lens.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white dark:bg-[#0A0A0B] border border-black/10 dark:border-white/10 p-8 flex flex-col h-full"
                >
                   <div className="mb-6 pb-6 border-b border-black/5 dark:border-white/5">
                      <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-500 mb-1">{lens.brand}</div>
                      <h3 className="text-xl font-display font-bold text-black dark:text-white uppercase">{lens.name}</h3>
                   </div>

                   <dl className="space-y-4 flex-grow">
                      <div className="flex justify-between">
                         <dt className="text-xs text-neutral-500">T-Stop</dt>
                         <dd className="text-sm font-mono font-bold text-black dark:text-white">{lens.tStop}</dd>
                      </div>
                      <div className="flex justify-between">
                         <dt className="text-xs text-neutral-500">Close Focus</dt>
                         <dd className="text-sm font-mono font-bold text-black dark:text-white">{lens.closeFocus}</dd>
                      </div>
                      <div className="flex justify-between">
                         <dt className="text-xs text-neutral-500">Front Diameter</dt>
                         <dd className="text-sm font-mono font-bold text-black dark:text-white">{lens.frontDia}</dd>
                      </div>
                      <div className="flex justify-between">
                         <dt className="text-xs text-neutral-500">Weight</dt>
                         <dd className="text-sm font-mono font-bold text-black dark:text-white">{lens.weight}</dd>
                      </div>
                      <div className="flex justify-between">
                         <dt className="text-xs text-neutral-500">Mount</dt>
                         <dd className="text-sm font-mono font-bold text-black dark:text-white">{lens.mount}</dd>
                      </div>
                      <div className="flex justify-between">
                         <dt className="text-xs text-neutral-500">Coverage</dt>
                         <dd className="text-sm font-mono font-bold text-black dark:text-white">{lens.coverage}</dd>
                      </div>
                   </dl>

                   <div className="pt-8 mt-6 border-t border-black/5 dark:border-white/5">
                      <Link href="/catalog" className="block text-center w-full py-3 bg-black text-white dark:bg-white dark:text-black text-[10px] font-bold uppercase tracking-widest hover:opacity-80 transition-opacity">
                         Request Rental
                      </Link>
                   </div>
                </motion.div>
             )
          })}
       </div>
    </div>
  );
};

const CameraMatrix = () => {
  return (
    <div className="overflow-x-auto bg-white dark:bg-[#0A0A0B] border border-black/10 dark:border-white/10">
      <table className="w-full text-left border-collapse">
        <thead>
           <tr className="bg-neutral-100 dark:bg-neutral-900 border-b border-black/10 dark:border-white/10">
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-neutral-500">Model</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-neutral-500">Sensor</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-neutral-500">Resolution</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-neutral-500">Dyn. Range</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-neutral-500">Mount</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-neutral-500">Media</th>
           </tr>
        </thead>
        <tbody>
           {CAMERAS_DB.map((cam) => (
             <tr key={cam.id} className="border-b border-black/5 dark:border-white/5 last:border-0 hover:bg-neutral-50 dark:hover:bg-white/5 transition-colors">
                <td className="p-4">
                   <div className="text-xs font-bold text-black dark:text-white uppercase">{cam.brand}</div>
                   <div className="text-sm font-mono">{cam.name}</div>
                </td>
                <td className="p-4 text-xs font-mono text-neutral-600 dark:text-neutral-400">{cam.sensor}</td>
                <td className="p-4 text-xs font-mono text-neutral-600 dark:text-neutral-400">{cam.res}</td>
                <td className="p-4 text-xs font-mono text-neutral-600 dark:text-neutral-400">{cam.dr}</td>
                <td className="p-4 text-xs font-mono text-neutral-600 dark:text-neutral-400">{cam.mount}</td>
                <td className="p-4 text-xs font-mono text-neutral-600 dark:text-neutral-400">{cam.media}</td>
             </tr>
           ))}
        </tbody>
      </table>
    </div>
  );
};

const MountChecker = () => {
  const [cameraMount, setCameraMount] = useState(MOUNT_TYPES[1].id);
  const [lensMount, setLensMount] = useState(MOUNT_TYPES[0].id);

  const cam = MOUNT_TYPES.find(m => m.id === cameraMount) || MOUNT_TYPES[0];
  const lens = MOUNT_TYPES.find(m => m.id === lensMount) || MOUNT_TYPES[0];

  let status: 'direct' | 'adapter' | 'incompatible' = 'incompatible';
  let message = '';

  if (cam.id === lens.id) {
    status = 'direct';
    message = 'Direct mechanical and flange fit.';
  } else if (cam.flange < lens.flange) {
    status = 'adapter';
    message = `Compatible via adapter. (Space for ${(lens.flange - cam.flange).toFixed(2)}mm adapter)`;
  } else {
    if (cam.id === 'lpl' && lens.id === 'pl') {
       status = 'adapter';
       message = 'Compatible via Standard LPL-to-PL Adapter.';
    } else {
       status = 'incompatible';
       message = `Likely incompatible. Lens flange (${lens.flange}mm) is shorter than Body flange (${cam.flange}mm), preventing infinity focus.`;
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
       <div className="space-y-6">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-3 text-neutral-500">Camera Mount</label>
            <select
              value={cameraMount}
              onChange={(e) => setCameraMount(e.target.value)}
              className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white p-4 text-sm focus:border-black dark:focus:border-white outline-none font-mono"
            >
              {MOUNT_TYPES.map(m => <option key={m.id} value={m.id}>{m.name} ({m.flange}mm)</option>)}
            </select>
          </div>

          <div className="flex justify-center text-neutral-300 dark:text-neutral-700">
             <ArrowRightLeft className="w-6 h-6 rotate-90 md:rotate-0" />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-3 text-neutral-500">Lens Mount</label>
            <select
              value={lensMount}
              onChange={(e) => setLensMount(e.target.value)}
              className="w-full bg-neutral-100 dark:bg-neutral-900 border border-black/10 dark:border-white/10 text-black dark:text-white p-4 text-sm focus:border-black dark:focus:border-white outline-none font-mono"
            >
              {MOUNT_TYPES.map(m => <option key={m.id} value={m.id}>{m.name} ({m.flange}mm)</option>)}
            </select>
          </div>
       </div>

       <div className="h-full flex flex-col justify-center">
          <div className={`p-8 border flex flex-col items-center text-center transition-colors duration-500 ${
             status === 'direct' ? 'bg-green-500/10 border-green-500/20' :
             status === 'adapter' ? 'bg-blue-500/10 border-blue-500/20' :
             'bg-red-500/10 border-red-500/20'
          }`}>
             {status === 'direct' && <CheckCircle2 className="w-12 h-12 text-green-500 mb-4" />}
             {status === 'adapter' && <Combine className="w-12 h-12 text-blue-500 mb-4" />}
             {status === 'incompatible' && <XCircle className="w-12 h-12 text-red-500 mb-4" />}

             <h3 className={`text-xl font-bold uppercase mb-2 ${
                status === 'direct' ? 'text-green-500' :
                status === 'adapter' ? 'text-blue-500' :
                'text-red-500'
             }`}>
                {status === 'direct' ? 'Native Fit' : status === 'adapter' ? 'Adapter Required' : 'Incompatible'}
             </h3>
             <p className="text-sm text-neutral-600 dark:text-neutral-300 max-w-xs">{message}</p>
          </div>
       </div>
    </div>
  );
};

// --- MAIN PAGE (inner — uses useSearchParams) ---

function ToolsInner() {
  const searchParams = useSearchParams();
  const [activeTool, setActiveTool] = useState<string | null>(null);

  useEffect(() => {
    const toolParam = searchParams.get('tool');
    if (toolParam) {
      setActiveTool(toolParam);
      setTimeout(() => {
         window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);
    }
  }, [searchParams]);

  const renderActiveTool = () => {
    switch(activeTool) {
      case 'fov': return <FOVCalculator />;
      case 'dof': return <DOFCalculator />;
      case 'power': return <PowerCalculator />;
      case 'storage': return <StorageCalculator />;
      case 'budget': return <BudgetEstimator />;
      case 'location': return <LocationScout />;
      case 'lens_compare': return <LensComparator />;
      case 'camera_matrix': return <CameraMatrix />;
      case 'mount_check': return <MountChecker />;
      default: return null;
    }
  };

  const getToolTitle = (id: string) => {
     switch(id) {
       case 'fov': return 'Field of View Calculator';
       case 'dof': return 'Depth of Field Calculator';
       case 'power': return 'Power Load Estimator';
       case 'storage': return 'Data & Storage';
       case 'budget': return 'Production Budget Estimator';
       case 'location': return 'Location Scout Helper';
       case 'lens_compare': return 'Lens Specification Comparator';
       case 'camera_matrix': return 'Camera Specification Matrix';
       case 'mount_check': return 'Mount Compatibility Checker';
       default: return '';
     }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-[#050505] text-black dark:text-white pt-32 pb-20 transition-colors duration-500">

      {/* Background Grid */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(0,0,0,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.02)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none z-0" />

      <div className="container mx-auto px-6 relative z-10">

        {/* Header */}
        <div className="flex flex-col mb-16">
          <div className="text-[10px] font-mono text-neutral-500 dark:text-accent uppercase tracking-widest mb-4">
             {activeTool ? (
                <button onClick={() => setActiveTool(null)} className="hover:text-black dark:hover:text-white flex items-center gap-1 transition-colors">
                   <ArrowLeft className="w-3 h-3" /> Back to Dashboard
                </button>
             ) : (
                '04 // Resources'
             )}
          </div>
          <h1 className="text-4xl md:text-6xl font-display font-medium tracking-tight uppercase">
            {activeTool ? getToolTitle(activeTool) : 'Technical Tools'}
          </h1>
        </div>

        <AnimatePresence mode="wait">
          {!activeTool ? (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-20"
            >
              {/* SECTION 1: BUSINESS & RENTAL */}
              <section>
                <div className="flex items-center gap-4 mb-8">
                   <div className="h-px bg-black/10 dark:bg-white/10 flex-grow" />
                   <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">Business & Production</h2>
                   <div className="h-px bg-black/10 dark:bg-white/10 flex-grow" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <ToolCard
                    title="Budget Estimator"
                    description="Calculate rough rental costs for camera, lighting, and crew."
                    icon={Banknote}
                    onClick={() => setActiveTool('budget')}
                    delay={0}
                  />
                  <ToolCard
                    title="Location Scout"
                    description="Joburg specific location data, permits, and conditions."
                    icon={MapPin}
                    onClick={() => setActiveTool('location')}
                    delay={0.1}
                  />
                </div>
              </section>

              {/* SECTION 2: CALCULATORS */}
              <section>
                <div className="flex items-center gap-4 mb-8">
                   <div className="h-px bg-black/10 dark:bg-white/10 flex-grow" />
                   <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">Technical Calculators</h2>
                   <div className="h-px bg-black/10 dark:bg-white/10 flex-grow" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <ToolCard
                    title="Field of View"
                    description="Visualize sensor coverage and lens equivalents."
                    icon={Maximize2}
                    onClick={() => setActiveTool('fov')}
                    delay={0}
                  />
                  <ToolCard
                    title="Depth of Field"
                    description="Calculate hyperfocal distance and focus limits."
                    icon={Aperture}
                    onClick={() => setActiveTool('dof')}
                    delay={0.1}
                  />
                  <ToolCard
                    title="Power Load"
                    description="Estimate wattage for lighting packages."
                    icon={Zap}
                    onClick={() => setActiveTool('power')}
                    delay={0.2}
                  />
                  <ToolCard
                    title="Data & Storage"
                    description="Project media storage requirements."
                    icon={HardDrive}
                    onClick={() => setActiveTool('storage')}
                    delay={0.3}
                  />
                </div>
              </section>

              {/* SECTION 3: SPECIFICATION TOOLS */}
              <section>
                <div className="flex items-center gap-4 mb-8">
                   <div className="h-px bg-black/10 dark:bg-white/10 flex-grow" />
                   <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-500">SPECIFICATION TOOLS</h2>
                   <div className="h-px bg-black/10 dark:bg-white/10 flex-grow" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <ToolCard
                    title="Lens Comparator"
                    description="Side-by-side spec comparison of rental lenses."
                    icon={Scale}
                    onClick={() => setActiveTool('lens_compare')}
                    delay={0.4}
                  />
                  <ToolCard
                    title="Camera Matrix"
                    description="Filterable specs for all rental camera systems."
                    icon={Table2}
                    onClick={() => setActiveTool('camera_matrix')}
                    delay={0.5}
                  />
                  <ToolCard
                    title="Mount Checker"
                    description="Verify lens and body compatibility and adapters."
                    icon={Combine}
                    onClick={() => setActiveTool('mount_check')}
                    delay={0.6}
                  />
                </div>
              </section>

            </motion.div>
          ) : (
            <motion.div
              key="tool"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.5 }}
            >
               {renderActiveTool()}
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}

export default function ToolsPage() {
  return (
    <Suspense>
      <ToolsInner />
    </Suspense>
  );
}
