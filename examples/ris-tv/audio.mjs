// Процедурная звуковая дорожка под зафиксированные сцены: node audio.mjs track.wav
import fs from 'node:fs';
const SR=44100, OUT=process.argv[2]||'track.wav';
const BEAT=0.5, BAR=2.0;                                   // 120 BPM
const T={on:0, card:4, count:8, ask:12, ask2:20, clip:26, ris:30, off:38, end:40};
const N=Math.round(T.end*SR), L=new Float32Array(N), Rr=new Float32Array(N);
let seed=20260915; const rnd=()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }; const g2=()=>rnd()*2-1;
const midi=m=>440*Math.pow(2,(m-69)/12);

function add(t0,arr,pan=0,gain=1){ const s0=Math.round(t0*SR), gl=Math.cos((pan+1)*Math.PI/4)*gain, gr=Math.sin((pan+1)*Math.PI/4)*gain;
  for(let i=0;i<arr.length;i++){ const k=s0+i; if(k<0||k>=N) continue; L[k]+=arr[i]*gl; Rr[k]+=arr[i]*gr; } }
function lp(arr,fc){ const a=1-Math.exp(-2*Math.PI*fc/SR); let y=0; const o=new Float32Array(arr.length); for(let i=0;i<arr.length;i++){ y+=a*(arr[i]-y); o[i]=y; } return o; }
function hp(arr,fc){ const l=lp(arr,fc); const o=new Float32Array(arr.length); for(let i=0;i<arr.length;i++) o[i]=arr[i]-l[i]; return o; }
function shape(arr,{att=0.005,rel=0.02,decay=0,hold=1}={}){ const n=arr.length, o=new Float32Array(n); const A=att*SR, Rl=rel*SR;
  for(let i=0;i<n;i++){ let e=hold; if(i<A) e*=i/A; if(i>n-Rl) e*=(n-i)/Rl; if(decay>0) e*=Math.exp(-i/SR/decay); o[i]=arr[i]*e; } return o; }
function osc(dur,f0,{f1=f0,wave='sine',amp=0.2,vib=0,vibHz=5,noiseAmt=0}={}){ const n=Math.round(dur*SR), o=new Float32Array(n); let ph=0;
  for(let i=0;i<n;i++){ const t=i/n, f=f0*Math.pow(f1/f0,t)*(1+vib*Math.sin(2*Math.PI*vibHz*i/SR)); ph+=f/SR; const x=ph%1;
    let v= wave==='sine'?Math.sin(2*Math.PI*x): wave==='saw'?2*x-1: wave==='square'?(x<0.5?1:-1): 1-4*Math.abs(x-0.5);
    o[i]=v*amp+(noiseAmt?g2()*noiseAmt:0); } return o; }
function noise(dur,{amp=0.2,lpf=0,hpf=0}={}){ const n=Math.round(dur*SR); let o=new Float32Array(n); for(let i=0;i<n;i++) o[i]=g2()*amp; if(lpf) o=lp(o,lpf); if(hpf) o=hp(o,hpf); return o; }
function mul(arr,fn){ const o=new Float32Array(arr.length); for(let i=0;i<arr.length;i++) o[i]=arr[i]*fn(i/SR); return o; }

// --- инструменты ---
const kick=(t,amp=0.55)=>{ add(t, shape(osc(0.32,150,{f1:42,amp}),{att:0.001,decay:0.11,rel:0.01})); add(t, shape(noise(0.02,{amp:0.25,lpf:4000}),{att:0.0005,decay:0.006})); };
const hat=(t,amp=0.10,open=false)=>add(t, shape(noise(open?0.25:0.06,{amp,hpf:7000}),{att:0.001,decay:open?0.09:0.02}),0.25);
const rim=(t,amp=0.22)=>{ add(t, shape(noise(0.08,{amp:amp*0.8,hpf:1500,lpf:6000}),{att:0.001,decay:0.03}),-0.2); add(t, shape(osc(0.06,420,{f1:380,amp:amp*0.5}),{att:0.001,decay:0.02}),-0.2); };
const click=(t,amp=0.3)=>add(t, shape(noise(0.006,{amp}),{att:0.0003,decay:0.002}));
const beep=(t,f,dur,amp=0.22,wave='sine')=>add(t, shape(osc(dur,f,{amp,wave}),{att:0.004,rel:0.03}));
const chord=(t,notes,dur,amp=0.08,wave='saw',cut=1800,det=0.004)=>{ for(const m of notes){ for(const d of [-det,det]){ add(t, shape(lp(osc(dur,midi(m)*(1+d),{amp,wave}),cut),{att:Math.min(0.6,dur*0.3),rel:Math.min(0.8,dur*0.4)}), d>0?0.35:-0.35); } } };
const chirp=(t,amp=0.10)=>{ let tt=t; for(let i=0;i<12;i++){ const f=1200+rnd()*1400; add(tt, shape(osc(0.022,f,{amp,wave:'square'}),{att:0.002,rel:0.004})); tt+=0.026; } };

// --- 1. включение и снег ---
click(0.0,0.5); add(0.0, shape(osc(0.35,90,{f1:40,amp:0.35}),{att:0.002,decay:0.12}));
add(0.02, shape(osc(T.off-0.02,50,{amp:0.022,wave:'sine'}),{att:0.4,rel:0.05}));            // гул сети до выключения
add(0.02, shape(osc(T.off-0.02,15734,{amp:0.0035}),{att:0.3,rel:0.05}));                        // писк строчной развёртки
add(0.45, mul(shape(noise(T.card-0.45,{amp:0.30,lpf:6500,hpf:120}),{att:0.15,rel:0.05}), t=>0.75+0.25*Math.sin(t*3.1)+0.1*Math.sin(t*17)));
beep(1.5,660,0.09,0.16); beep(1.6,880,0.14,0.16);
// --- 2. таблица: тон 1 кГц и ускоряющиеся тики ---
add(T.card, shape(mul(osc(T.count-T.card,1000,{amp:0.055}), t=>1+0.06*Math.sin(t*6)),{att:0.05,rel:0.05}));
for(let t=T.card;t<T.count;){ const a=Math.pow((t-T.card)/(T.count-T.card),2.4); const step= a<0.2?BEAT : a<0.45?BEAT/2 : a<0.75?BEAT/4 : BEAT/8;
  click(t,0.3); add(t, shape(osc(0.03,2100,{amp:0.2}),{att:0.001,decay:0.01})); t+=step; }
// --- 3. отсчёт ---
for(let i=0;i<5;i++) beep(T.count+i*BEAT,880,0.12,0.26);
beep(T.count+5*BEAT,1320,0.42,0.28);
{ const t0=T.count+6*BEAT; for(let t=t0;t<T.ask;t+=0.125){ const on=rnd()<0.7; if(on) add(t, shape(osc(0.11,(Math.floor((t-t0)/0.125)%2)?700:900,{amp:0.10,wave:'square'}),{att:0.003,rel:0.01}));
    if(rnd()<0.5) add(t+rnd()*0.1, shape(noise(0.05+rnd()*0.08,{amp:0.25,lpf:3000}),{att:0.002,decay:0.03})); }
  add(t0, shape(osc(T.ask-t0,110,{amp:0.07,wave:'square'}),{att:0.02,rel:0.05})); }
// --- 4. телетекст: бит и «данные» ---
for(let bar=0;bar<7;bar++){ const b0=T.ask+bar*BAR; if(bar<4) chirp(b0,0.09);
  for(let k=0;k<4;k++){ const t=b0+k*BEAT; if(k===0||k===2) kick(t,0.5); if(k===1||k===3) rim(t,0.2); hat(t,0.08); hat(t+BEAT/2,0.05); } }
add(T.ask, shape(osc(7*BAR,midi(45),{amp:0.09,wave:'sine'}),{att:0.01,rel:0.3}));           // низкий гул-подложка A1
beep(T.ask2,880,0.05,0.14); beep(T.ask2+0.07,1320,0.08,0.14);                                  // перелистывание страницы
for(let k=0;k<3;k++) chirp(T.ask2+1.0+k*1.5,0.09);
// --- 5. осциллограф ---
add(T.clip, shape(osc(1.75,160,{f1:540,amp:0.11,vib:0.006,vibHz:7}),{att:0.05,rel:0.15}));
{ const sweep=mul(noise(1.33,{amp:0.16,lpf:2500,hpf:300}), t=>Math.sin(Math.PI*t/1.33)); const s0=Math.round((T.clip+2.0)*SR);
  for(let i=0;i<sweep.length;i++){ const k=s0+i; if(k>=N) break; const p=i/sweep.length; L[k]+=sweep[i]*Math.cos(p*Math.PI/2); Rr[k]+=sweep[i]*Math.sin(p*Math.PI/2); } }
beep(T.clip+3.35,150,0.12,0.2,'square'); beep(T.clip+3.55,150,0.14,0.2,'square');
for(let t=T.clip+3.4;t<T.ris;t+=0.07) if(rnd()<0.35) click(t,0.12);
// --- 6. портрет: захват сигнала, пэд и бит ---
add(T.ris, mul(shape(noise(1.7,{amp:0.28,lpf:5000,hpf:150}),{att:0.01,rel:0.3}), t=>Math.pow(1-t/1.7,1.6)*(0.7+0.3*Math.sin(t*40))));
for(let t=T.ris;t<T.ris+1.7;t+=0.05) if(rnd()<0.4) click(t,0.18*(1-(t-T.ris)/1.7));
chord(T.ris+1.2,[45,52,57,61,64],T.off-T.ris-1.2,0.05,'saw',1600);                            // A-мажор, пэд до выключения
add(T.ris+1.65, shape(osc(0.4,3000,{f1:600,amp:0.12}),{att:0.002,decay:0.12}));                // «щёлк» захвата
for(let bar=1;bar<4;bar++){ const b0=T.ris+bar*BAR; for(let k=0;k<4;k++){ const t=b0+k*BEAT; kick(t,0.5); hat(t+BEAT/2,0.09); if(k===1||k===3) rim(t,0.16);
    add(t, shape(osc(BEAT*0.45,midi(33),{amp:0.13,wave:'sine'}),{att:0.005,rel:0.08})); add(t+BEAT/2, shape(osc(BEAT*0.3,midi(33),{amp:0.09,wave:'sine'}),{att:0.005,rel:0.06})); } }
add(T.ris+1*BAR+1.0, shape(noise(0.35,{amp:0.12,hpf:2000}),{att:0.05,rel:0.25}),0.4);          // вжух плашки
chord(T.ris+2*BAR,[57,61,64,69],0.35,0.16,'saw',2600); chord(T.ris+2*BAR+BEAT,[59,62,66,71],0.5,0.16,'saw',2600);
add(T.off-1.0, mul(shape(noise(1.0,{amp:0.14,hpf:600}),{att:0.3,rel:0.02}), t=>t*t));          // подъём перед выключением
// --- 7. выключение ---
click(T.off,0.6); add(T.off, shape(osc(0.35,120,{f1:38,amp:0.6}),{att:0.001,decay:0.09}));
add(T.off+0.02, shape(osc(1.6,15734,{f1:14800,amp:0.02}),{att:0.001,decay:0.5}));
for(let t=T.off+0.1;t<T.off+0.7;t+=0.04) if(rnd()<0.5) click(t,0.06*(1-(t-T.off)/0.7));
add(T.off+1.0, shape(osc(1.0,1760,{amp:0.06}),{att:0.005,decay:0.35})); add(T.off+1.0, shape(osc(1.0,2640,{amp:0.03}),{att:0.005,decay:0.25}));

// --- мастер: мягкий лимитер и запись ---
let peak=0; for(let i=0;i<N;i++){ L[i]=Math.tanh(L[i]*1.3); Rr[i]=Math.tanh(Rr[i]*1.3); peak=Math.max(peak,Math.abs(L[i]),Math.abs(Rr[i])); }
const norm=0.89/peak; const buf=Buffer.alloc(44+N*4);
buf.write('RIFF',0); buf.writeUInt32LE(36+N*4,4); buf.write('WAVE',8); buf.write('fmt ',12); buf.writeUInt32LE(16,16); buf.writeUInt16LE(1,20); buf.writeUInt16LE(2,22);
buf.writeUInt32LE(SR,24); buf.writeUInt32LE(SR*4,28); buf.writeUInt16LE(4,32); buf.writeUInt16LE(16,34); buf.write('data',36); buf.writeUInt32LE(N*4,40);
for(let i=0;i<N;i++){ buf.writeInt16LE(Math.round(L[i]*norm*32767),44+i*4); buf.writeInt16LE(Math.round(Rr[i]*norm*32767),46+i*4); }
fs.writeFileSync(OUT,buf); console.log(`${OUT}: ${T.end} с, пик до нормализации ${peak.toFixed(2)}`);
