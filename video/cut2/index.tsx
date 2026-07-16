import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Composition,
  Easing,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {registerRoot} from 'remotion';

const C = {
  ink: '#0a0d12',
  panel: '#111720',
  panel2: '#151d28',
  lime: '#c6f24a',
  white: '#ffffff',
  muted: '#93a0b3',
  line: 'rgba(255,255,255,.10)',
};

const FPS = 30;
const BEAT = FPS * 4;

const clamp = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};
const ease = Easing.bezier(0.22, 1, 0.36, 1);

const fade = (frame: number, duration: number) =>
  interpolate(frame, [0, 12, duration - 12, duration], [0, 1, 1, 0], clamp);

const rise = (frame: number, delay = 0, distance = 28) =>
  interpolate(frame, [delay, delay + 18], [distance, 0], {...clamp, easing: ease});

const Logo = ({compact = false}: {compact?: boolean}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: compact ? 12 : 16}}>
    <div style={{width: compact ? 34 : 44, height: compact ? 34 : 44, color: C.lime}}>
      <Img src={staticFile('posecode-mark.svg')} style={{width: '100%', height: '100%'}} />
    </div>
    <div style={{fontWeight: 850, fontSize: compact ? 26 : 34, letterSpacing: '-0.04em'}}>posecode</div>
  </div>
);

const Shell = ({children}: {children: React.ReactNode}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{backgroundColor: C.ink, color: C.white, fontFamily: 'Inter, Hanken Grotesk, Arial, sans-serif', overflow: 'hidden'}}>
      <AbsoluteFill style={{backgroundImage: 'linear-gradient(rgba(198,242,74,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(198,242,74,.035) 1px, transparent 1px)', backgroundSize: '64px 64px', opacity: 0.6}} />
      <div style={{position: 'absolute', width: 900, height: 900, borderRadius: 900, left: -390, top: -500, background: 'radial-gradient(circle, rgba(198,242,74,.12), rgba(198,242,74,0) 68%)', transform: `translateX(${Math.sin(frame / 90) * 20}px)`}} />
      <div style={{position: 'absolute', inset: 0, background: 'radial-gradient(circle at 75% 40%, transparent 0%, rgba(10,13,18,.18) 45%, rgba(10,13,18,.7) 100%)'}} />
      <div style={{position: 'absolute', top: 46, left: 66, right: 66, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 20}}>
        <Logo compact />
        <div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 17, color: C.muted, letterSpacing: '.12em'}}>TEXT → MOTION</div>
      </div>
      {children}
    </AbsoluteFill>
  );
};

const Progress = () => {
  const frame = useCurrentFrame();
  const beat = Math.min(6, Math.floor(frame / BEAT));
  const local = frame % BEAT;
  const fill = ((beat + interpolate(local, [0, BEAT], [0, 1], clamp)) / 7) * 100;
  return (
    <div style={{position: 'absolute', top: 112, left: 66, right: 66, height: 20, zIndex: 30}}>
      <div style={{position: 'absolute', top: 8, left: 8, right: 8, height: 2, background: C.line}} />
      <div style={{position: 'absolute', top: 8, left: 8, width: `calc(${fill}% - 16px)`, height: 2, background: C.lime, boxShadow: '0 0 14px rgba(198,242,74,.65)'}} />
      <div style={{position: 'relative', display: 'flex', justifyContent: 'space-between'}}>
        {Array.from({length: 7}).map((_, i) => (
          <div key={i} style={{width: 18, height: 18, borderRadius: 20, boxSizing: 'border-box', border: `2px solid ${i <= beat ? C.lime : '#394452'}`, background: i < beat ? C.lime : C.ink, boxShadow: i === beat ? '0 0 18px rgba(198,242,74,.55)' : 'none'}} />
        ))}
      </div>
    </div>
  );
};

const Caption = ({children, keyword}: {children: string; keyword: string}) => {
  const frame = useCurrentFrame();
  const parts = children.split(keyword);
  return (
    <div style={{position: 'absolute', zIndex: 40, left: 120, right: 120, bottom: 92, display: 'flex', justifyContent: 'center', opacity: fade(frame, BEAT)}}>
      <div style={{fontWeight: 800, fontSize: 56, lineHeight: 1.08, letterSpacing: '-.035em', padding: '18px 28px 20px', borderRadius: 18, background: 'rgba(0,0,0,.58)', boxShadow: '0 14px 45px rgba(0,0,0,.35)', whiteSpace: 'nowrap'}}>
        {parts[0]}<span style={{color: C.lime}}>{keyword}</span>{parts[1]}
      </div>
    </div>
  );
};

const Window = ({title, children, style}: {title: string; children: React.ReactNode; style?: React.CSSProperties}) => (
  <div style={{background: 'rgba(17,23,32,.94)', border: `1px solid ${C.line}`, borderRadius: 24, overflow: 'hidden', boxShadow: '0 38px 90px rgba(0,0,0,.42)', ...style}}>
    <div style={{height: 54, display: 'flex', alignItems: 'center', borderBottom: `1px solid ${C.line}`, padding: '0 20px', gap: 9}}>
      <i style={{width: 11, height: 11, borderRadius: 20, background: '#ff6b66'}} />
      <i style={{width: 11, height: 11, borderRadius: 20, background: '#ffc65b'}} />
      <i style={{width: 11, height: 11, borderRadius: 20, background: C.lime}} />
      <span style={{marginLeft: 14, color: C.muted, fontFamily: 'JetBrains Mono, monospace', fontSize: 16}}>{title}</span>
    </div>
    {children}
  </div>
);

const MoveVideo = ({src, style}: {src: string; style?: React.CSSProperties}) => (
  <div style={{position: 'relative', overflow: 'hidden', background: 'linear-gradient(145deg, #111922, #080b0f)', ...style}}>
    <OffthreadVideo src={staticFile(src)} muted loop style={{width: '100%', height: '100%', objectFit: 'contain'}} />
    <div style={{position: 'absolute', inset: 0, boxShadow: 'inset 0 0 70px rgba(10,13,18,.6)'}} />
    <div style={{position: 'absolute', top: 18, left: 18, fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: C.lime, border: '1px solid rgba(198,242,74,.35)', background: 'rgba(10,13,18,.78)', borderRadius: 999, padding: '7px 11px'}}>● LIVE</div>
  </div>
);

const Hook = () => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{opacity: fade(frame, BEAT)}}>
    <div style={{position: 'absolute', left: 112, top: 235, width: 850, transform: `translateY(${rise(frame, 0, 42)}px)`}}>
      <div style={{fontFamily: 'JetBrains Mono, monospace', color: C.lime, fontSize: 18, letterSpacing: '.14em', marginBottom: 20}}>A LANGUAGE FOR HUMAN MOTION</div>
      <div style={{fontSize: 112, lineHeight: .92, fontWeight: 860, letterSpacing: '-.065em'}}>Movement,<br/><span style={{color: C.lime}}>written.</span></div>
      <div style={{fontSize: 25, color: C.muted, marginTop: 28, maxWidth: 610, lineHeight: 1.4}}>Plain text in. Smooth, programmable 3D motion out.</div>
    </div>
    <div style={{position: 'absolute', right: 130, top: 190, width: 520, height: 650, borderRadius: 34, border: `1px solid ${C.line}`, transform: `translateY(${rise(frame, 6, 56)}px) rotate(2deg)`}}>
      <MoveVideo src="jumping-jacks.mp4" style={{width: '100%', height: '100%', borderRadius: 34}} />
    </div>
    <Caption keyword="text">Movement. Written as text.</Caption>
  </AbsoluteFill>;
};

const Ask = () => {
  const frame = useCurrentFrame();
  const typed = 'write a squat in Posecode.';
  const count = Math.floor(interpolate(frame, [16, 65], [0, typed.length], clamp));
  return <AbsoluteFill style={{opacity: fade(frame, BEAT)}}>
    <div style={{position: 'absolute', top: 210, left: 190, right: 190, transform: `translateY(${rise(frame)}px)`}}>
      <Window title="agent / new task">
        <div style={{height: 475, padding: '52px 60px', boxSizing: 'border-box'}}>
          <div style={{color: C.muted, fontSize: 16, letterSpacing: '.12em', fontFamily: 'JetBrains Mono, monospace', marginBottom: 26}}>YOU</div>
          <div style={{fontSize: 53, lineHeight: 1.2, fontWeight: 710, letterSpacing: '-.035em'}}>“{typed.slice(0, count)}<span style={{display: 'inline-block', width: 3, height: 54, verticalAlign: '-8px', background: C.lime, opacity: frame % 16 < 9 ? 1 : 0}} />”</div>
          <div style={{marginTop: 58, display: 'flex', alignItems: 'center', gap: 14, color: C.muted, fontSize: 19}}>
            <span style={{display: 'inline-block', width: 11, height: 11, borderRadius: 20, background: C.lime, boxShadow: '0 0 16px rgba(198,242,74,.6)'}} /> Agent connected
          </div>
        </div>
      </Window>
    </div>
    <Caption keyword="squat">Ask any LLM: “write a squat in Posecode.”</Caption>
  </AbsoluteFill>;
};

const CodeLines = ({frame, compact = false}: {frame: number; compact?: boolean}) => {
  const lines = [
    ['posecode', ' exercise ', '"Body-weight squat"'],
    ['  rig', ' humanoid', ''],
    ['  pose', ' start = standing', ''],
    ['', '', ''],
    ['  step', ' "Descend" 1.6s settle:', ''],
    ['    hips:', ' flex 80', ''],
    ['    knees:', ' flex 95', ''],
    ['    ground-lock:', ' feet', ''],
    ['  step', ' "Drive up" 1.2s drive:', ''],
    ['    hips:', ' flex 0', ''],
    ['    knees:', ' flex 0', ''],
    ['  repeat', ' 8', ''],
  ];
  const visible = interpolate(frame, [8, 96], [0, lines.length], clamp);
  return <div style={{fontFamily: 'JetBrains Mono, SFMono-Regular, monospace', fontSize: compact ? 18 : 25, lineHeight: compact ? 1.58 : 1.62}}>
    {lines.map((l, i) => <div key={i} style={{height: compact ? 29 : 41, opacity: visible > i ? 1 : 0, transform: `translateX(${visible > i ? 0 : 18}px)`, color: '#d8e0ec'}}>
      <span style={{color: C.lime}}>{l[0]}</span><span>{l[1]}</span><span style={{color: '#8fd7ff'}}>{l[2]}</span>
    </div>)}
  </div>;
};

const AgentWork = () => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{opacity: fade(frame, BEAT)}}>
    <div style={{position: 'absolute', top: 176, left: 150, right: 150, transform: `translateY(${rise(frame)}px)`}}>
      <Window title="squat.posecode">
        <div style={{height: 590, padding: '28px 44px', position: 'relative'}}>
          <CodeLines frame={frame} />
          <div style={{position: 'absolute', right: 36, bottom: 30, borderRadius: 999, background: 'rgba(198,242,74,.10)', border: '1px solid rgba(198,242,74,.25)', color: C.lime, fontFamily: 'JetBrains Mono, monospace', fontSize: 15, padding: '9px 14px'}}>valid syntax ✓</div>
        </div>
      </Window>
    </div>
    <Caption keyword="writes">It writes it.</Caption>
  </AbsoluteFill>;
};

const Result = () => {
  const frame = useCurrentFrame();
  const split = interpolate(frame, [8, 28], [0, 1], {...clamp, easing: ease});
  return <AbsoluteFill style={{opacity: fade(frame, BEAT)}}>
    <div style={{position: 'absolute', top: 180, left: 118, right: 118, height: 650, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, transform: `translateY(${rise(frame)}px)`}}>
      <Window title="squat.posecode" style={{height: '100%', opacity: .72 + split * .28}}>
        <div style={{padding: '28px 32px'}}><CodeLines frame={110} compact /></div>
      </Window>
      <div style={{height: '100%', borderRadius: 24, border: '1px solid rgba(198,242,74,.22)', boxShadow: '0 35px 80px rgba(0,0,0,.45)', transform: `scale(${.94 + split * .06})`}}>
        <MoveVideo src="squat.mp4" style={{width: '100%', height: '100%', borderRadius: 24}} />
      </div>
      <div style={{position: 'absolute', left: 'calc(50% - 30px)', top: 290, width: 60, height: 60, borderRadius: 60, background: C.lime, color: C.ink, display: 'grid', placeItems: 'center', fontSize: 31, fontWeight: 900, boxShadow: '0 0 30px rgba(198,242,74,.5)', transform: `scale(${split})`}}>→</div>
    </div>
    <Caption keyword="renders">It renders safely at 60fps.</Caption>
  </AbsoluteFill>;
};

const Mcp = () => {
  const frame = useCurrentFrame();
  const entries = [
    ['$ npx posecode-mcp', ''],
    ['● connected', 'posecode / MCP'],
    ['→ posecode_authoring_guide', 'done  42ms'],
    ['→ validate_posecode', 'safe ROM  ✓'],
    ['→ render_posecode', 'preview ready  ✓'],
  ];
  return <AbsoluteFill style={{opacity: fade(frame, BEAT)}}>
    <div style={{position: 'absolute', top: 195, left: 135, right: 135, display: 'grid', gridTemplateColumns: '1.25fr .75fr', gap: 24, transform: `translateY(${rise(frame)}px)`}}>
      <Window title="terminal: posecode-mcp">
        <div style={{height: 560, padding: '42px 42px', boxSizing: 'border-box', fontFamily: 'JetBrains Mono, monospace'}}>
          {entries.map(([a,b], i) => <div key={a} style={{display: 'flex', justifyContent: 'space-between', fontSize: i === 0 ? 25 : 20, lineHeight: 2.35, opacity: interpolate(frame, [i * 14, i * 14 + 8], [0, 1], clamp), color: i === 0 ? C.white : i === 1 ? C.lime : '#d2dae6'}}><span>{a}</span><span style={{color: i > 1 ? C.lime : C.muted}}>{b}</span></div>)}
        </div>
      </Window>
      <div style={{height: 614, borderRadius: 24, border: `1px solid ${C.line}`}}><MoveVideo src="squat.mp4" style={{width: '100%', height: '100%', borderRadius: 24}} /></div>
    </div>
    <Caption keyword="MCP">MCP: agents author + render natively.</Caption>
  </AbsoluteFill>;
};

const Embed = () => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{opacity: fade(frame, BEAT)}}>
    <div style={{position: 'absolute', left: 110, right: 110, top: 188, display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: 22, transform: `translateY(${rise(frame)}px)`}}>
      <Window title="demo.html">
        <div style={{height: 578, padding: '48px 42px', boxSizing: 'border-box', fontFamily: 'JetBrains Mono, monospace', fontSize: 22, lineHeight: 1.75}}>
          <div style={{color: '#7e8b9e'}}>&lt;!doctype html&gt;</div>
          <div><span style={{color: '#8fd7ff'}}>&lt;script</span> <span style={{color: C.lime}}>src</span>=<span style={{color: '#ffd38f'}}>"https://unpkg.com/</span></div>
          <div style={{paddingLeft: 26, color: '#ffd38f'}}>posecode-embed/dist/posecode-embed.js"</div>
          <div style={{color: '#8fd7ff'}}>&gt;&lt;/script&gt;</div>
          <div style={{height: 28}} />
          <div><span style={{color: '#8fd7ff'}}>&lt;posecode-player</span></div>
          <div style={{paddingLeft: 26}}><span style={{color: C.lime}}>src</span>=<span style={{color: '#ffd38f'}}>"/movements/squat.posecode"</span></div>
          <div style={{color: '#8fd7ff'}}>&gt;&lt;/posecode-player&gt;</div>
          <div style={{marginTop: 32, color: C.lime, fontSize: 16, opacity: interpolate(frame, [35, 52], [0, 1], clamp)}}>✓ custom element registered</div>
        </div>
      </Window>
      <Window title="localhost:3000">
        <MoveVideo src="squat.mp4" style={{height: 578}} />
      </Window>
    </div>
    <Caption keyword="script">Embed: one &lt;script&gt;. Drop it anywhere.</Caption>
  </AbsoluteFill>;
};

const Anywhere = () => {
  const frame = useCurrentFrame();
  const end = interpolate(frame, [58, 102], [0, 1], {...clamp, easing: ease});
  return <AbsoluteFill style={{opacity: interpolate(frame, [0, 12], [0, 1], clamp)}}>
    <div style={{position: 'absolute', left: interpolate(end, [0, 1], [245, 155]), top: 190, width: 455, height: 715, borderRadius: 58, padding: 13, background: '#050709', border: '2px solid #35404e', boxShadow: '0 45px 100px rgba(0,0,0,.55)', transform: `translateY(${rise(frame, 0, 50)}px) rotate(-2deg)`}}>
      <div style={{height: '100%', borderRadius: 46, overflow: 'hidden', position: 'relative'}}>
        <MoveVideo src="squat.mp4" style={{width: '100%', height: '100%'}} />
        <div style={{position: 'absolute', top: 11, left: '50%', transform: 'translateX(-50%)', width: 125, height: 30, borderRadius: 30, background: '#050709'}} />
      </div>
    </div>
    <div style={{position: 'absolute', left: 785, top: 290, opacity: interpolate(frame, [22, 42], [0, 1], clamp), transform: `translateX(${interpolate(frame, [20, 44], [40, 0], {...clamp, easing: ease})}px)`}}>
      <div style={{fontSize: 91, lineHeight: .98, fontWeight: 860, letterSpacing: '-.06em'}}>Motion,<br/><span style={{color: C.lime}}>anywhere.</span></div>
      <div style={{fontSize: 25, color: C.muted, marginTop: 28}}>Agent-native. Web-native. Open source.</div>
      <div style={{marginTop: 52, display: 'flex', alignItems: 'center', gap: 22}}><Logo/><div style={{height: 44, width: 1, background: C.line}}/><div style={{fontFamily: 'JetBrains Mono, monospace', fontSize: 23, color: C.lime}}>posecode.org</div></div>
    </div>
    <Caption keyword="posecode.org">Any app. Any phone. posecode.org</Caption>
  </AbsoluteFill>;
};

const Cut2 = () => (
  <Shell>
    <Progress />
    <Audio src={staticFile('cut2-score.wav')} volume={0.55} />
    <Sequence from={0} durationInFrames={BEAT}><Hook /></Sequence>
    <Sequence from={BEAT} durationInFrames={BEAT}><Ask /></Sequence>
    <Sequence from={BEAT * 2} durationInFrames={BEAT}><AgentWork /></Sequence>
    <Sequence from={BEAT * 3} durationInFrames={BEAT}><Result /></Sequence>
    <Sequence from={BEAT * 4} durationInFrames={BEAT}><Mcp /></Sequence>
    <Sequence from={BEAT * 5} durationInFrames={BEAT}><Embed /></Sequence>
    <Sequence from={BEAT * 6} durationInFrames={BEAT}><Anywhere /></Sequence>
  </Shell>
);

const VCaption = ({text, keyword}: {text: string; keyword: string}) => {
  const frame = useCurrentFrame() % BEAT;
  const parts = text.split(keyword);
  return <div style={{position: 'absolute', left: 46, right: 46, bottom: 175, zIndex: 50, display: 'flex', justifyContent: 'center', opacity: fade(frame, BEAT)}}>
    <div style={{fontWeight: 850, fontSize: text.length > 30 ? 61 : 78, lineHeight: 1.05, letterSpacing: '-.045em', textAlign: 'center', background: 'rgba(0,0,0,.64)', borderRadius: 24, padding: '22px 26px 25px', boxShadow: '0 18px 50px rgba(0,0,0,.4)', whiteSpace: 'nowrap'}}>{parts[0]}<span style={{color: C.lime}}>{keyword}</span>{parts[1]}</div>
  </div>;
};

const VFrame = ({children}: {children: React.ReactNode}) => {
  const frame = useCurrentFrame();
  const beat = Math.floor(frame / BEAT);
  return <AbsoluteFill style={{background: C.ink, color: C.white, fontFamily: 'Inter, Hanken Grotesk, Arial, sans-serif', overflow: 'hidden'}}>
    <AbsoluteFill style={{backgroundImage: 'linear-gradient(rgba(198,242,74,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(198,242,74,.035) 1px, transparent 1px)', backgroundSize: '58px 58px'}} />
    <div style={{position: 'absolute', width: 900, height: 900, borderRadius: 900, left: -350, top: -480, background: 'radial-gradient(circle, rgba(198,242,74,.15), transparent 68%)'}} />
    <div style={{position: 'absolute', top: 58, left: 50, right: 50, display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 30}}><Logo compact/><div style={{fontFamily: 'JetBrains Mono, monospace', color: C.muted, fontSize: 16}}>TEXT → MOTION</div></div>
    <div style={{position: 'absolute', top: 132, left: 50, right: 50, height: 8, background: 'rgba(255,255,255,.1)', borderRadius: 8, overflow: 'hidden', zIndex: 30}}><div style={{width: `${((frame + 1) / (BEAT * 7)) * 100}%`, height: '100%', background: C.lime, boxShadow: '0 0 16px rgba(198,242,74,.7)'}} /></div>
    <div style={{position: 'absolute', top: 158, left: 52, fontFamily: 'JetBrains Mono, monospace', color: C.lime, fontSize: 17, letterSpacing: '.12em'}}>0{beat + 1} / 07</div>
    {children}
  </AbsoluteFill>;
};

const VCard = ({children, title, style}: {children: React.ReactNode; title: string; style?: React.CSSProperties}) => <Window title={title} style={{...style}}>{children}</Window>;

const VerticalCut2 = () => {
  const frame = useCurrentFrame();
  const local = frame % BEAT;
  const beat = Math.min(6, Math.floor(frame / BEAT));
  const captions = [
    ['Movement. Written as text.', 'text'],
    ['Ask: “write a squat in Posecode.”', 'squat'],
    ['The agent writes it.', 'writes'],
    ['It renders. Safe. Smooth.', 'renders'],
    ['MCP: author + render natively.', 'MCP'],
    ['One script. Embed anywhere.', 'script'],
    ['Any app. Any phone. posecode.org', 'posecode.org'],
  ];
  const sceneStyle: React.CSSProperties = {position: 'absolute', inset: 0, opacity: fade(local, BEAT), transform: `translateY(${rise(local, 0, 44)}px)`};

  return <VFrame>
    <Audio src={staticFile('cut2-score.wav')} volume={0.55} />
    {beat === 0 && <div style={sceneStyle}>
      <div style={{position: 'absolute', top: 260, left: 70, right: 70, textAlign: 'center'}}><div style={{fontSize: 122, fontWeight: 880, lineHeight: .9, letterSpacing: '-.07em'}}>Movement,<br/><span style={{color: C.lime}}>written.</span></div><div style={{fontSize: 25, color: C.muted, marginTop: 30}}>Plain text in. 3D motion out.</div></div>
      <div style={{position: 'absolute', left: 180, right: 180, top: 625, height: 790, borderRadius: 38, border: `1px solid ${C.line}`}}><MoveVideo src="jumping-jacks.mp4" style={{width: '100%', height: '100%', borderRadius: 38}} /></div>
    </div>}
    {beat === 1 && <div style={sceneStyle}>
      <div style={{position: 'absolute', top: 330, left: 58, right: 58}}><VCard title="agent / new task"><div style={{height: 760, padding: '62px 48px'}}><div style={{fontFamily: 'JetBrains Mono, monospace', color: C.muted, fontSize: 18, letterSpacing: '.12em'}}>YOU</div><div style={{fontSize: 68, fontWeight: 760, lineHeight: 1.12, letterSpacing: '-.045em', marginTop: 32}}>“write a squat<br/>in <span style={{color: C.lime}}>Posecode.</span>”</div><div style={{marginTop: 70, color: C.muted, fontSize: 22}}><span style={{color: C.lime}}>●</span> Agent connected</div></div></VCard></div>
    </div>}
    {beat === 2 && <div style={sceneStyle}>
      <div style={{position: 'absolute', top: 270, left: 46, right: 46}}><VCard title="squat.posecode"><div style={{height: 1020, padding: '40px 36px'}}><CodeLines frame={local} compact /></div></VCard></div>
    </div>}
    {beat === 3 && <div style={sceneStyle}>
      <div style={{position: 'absolute', top: 245, left: 65, right: 65, height: 1110, borderRadius: 40, border: '1px solid rgba(198,242,74,.25)', boxShadow: '0 40px 90px rgba(0,0,0,.5)'}}><MoveVideo src="squat.mp4" style={{width: '100%', height: '100%', borderRadius: 40}} /></div>
      <div style={{position: 'absolute', right: 48, top: 330, background: C.lime, color: C.ink, fontFamily: 'JetBrains Mono, monospace', fontWeight: 800, borderRadius: 999, padding: '13px 18px'}}>60 FPS</div>
    </div>}
    {beat === 4 && <div style={sceneStyle}>
      <div style={{position: 'absolute', top: 285, left: 48, right: 48}}><VCard title="terminal: posecode-mcp"><div style={{height: 920, padding: '48px 38px', fontFamily: 'JetBrains Mono, monospace', fontSize: 25, lineHeight: 2.4}}><div style={{fontSize: 30, color: C.white}}>$ npx posecode-mcp</div><div style={{color: C.lime}}>● connected</div><div>→ authoring_guide <span style={{float: 'right', color: C.lime}}>✓</span></div><div>→ validate_posecode <span style={{float: 'right', color: C.lime}}>safe ✓</span></div><div>→ render_posecode <span style={{float: 'right', color: C.lime}}>ready ✓</span></div><div style={{height: 330, marginTop: 30, borderRadius: 22, border: `1px solid ${C.line}`}}><MoveVideo src="squat.mp4" style={{height: '100%', borderRadius: 22}} /></div></div></VCard></div>
    </div>}
    {beat === 5 && <div style={sceneStyle}>
      <div style={{position: 'absolute', top: 255, left: 42, right: 42}}><VCard title="demo.html"><div style={{height: 1050, padding: '45px 35px', boxSizing: 'border-box', fontFamily: 'JetBrains Mono, monospace', fontSize: 23, lineHeight: 1.7}}><div style={{color: '#8fd7ff'}}>&lt;script</div><div style={{paddingLeft: 24}}><span style={{color: C.lime}}>src</span>=<span style={{color: '#ffd38f'}}>"https://unpkg.com/</span></div><div style={{paddingLeft: 24, color: '#ffd38f'}}>posecode-embed/dist/</div><div style={{paddingLeft: 24, color: '#ffd38f'}}>posecode-embed.js"</div><div style={{color: '#8fd7ff'}}>&gt;&lt;/script&gt;</div><div style={{height: 34}}/><div style={{color: '#8fd7ff'}}>&lt;posecode-player</div><div style={{paddingLeft: 24}}><span style={{color: C.lime}}>src</span>=<span style={{color: '#ffd38f'}}>"/movements/</span></div><div style={{paddingLeft: 24, color: '#ffd38f'}}>squat.posecode"</div><div style={{color: '#8fd7ff'}}>&gt;&lt;/posecode-player&gt;</div><div style={{height: 360, marginTop: 30, border: `1px solid ${C.line}`, borderRadius: 22}}><MoveVideo src="squat.mp4" style={{height: '100%', borderRadius: 22}} /></div></div></VCard></div>
    </div>}
    {beat === 6 && <div style={sceneStyle}>
      <div style={{position: 'absolute', top: 245, left: 230, width: 620, height: 990, borderRadius: 72, padding: 15, background: '#050709', border: '3px solid #35404e', boxShadow: '0 45px 110px rgba(0,0,0,.6)'}}><div style={{height: '100%', borderRadius: 58, overflow: 'hidden', position: 'relative'}}><MoveVideo src="squat.mp4" style={{width: '100%', height: '100%'}}/><div style={{position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', width: 170, height: 38, borderRadius: 40, background: '#050709'}}/></div></div>
      <div style={{position: 'absolute', top: 1285, left: 0, right: 0, textAlign: 'center'}}><div style={{fontSize: 83, fontWeight: 880, letterSpacing: '-.06em'}}>Motion, <span style={{color: C.lime}}>anywhere.</span></div><div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 25, marginTop: 28}}><Logo/><span style={{fontFamily: 'JetBrains Mono, monospace', color: C.lime, fontSize: 25}}>posecode.org</span></div></div>
    </div>}
    <VCaption text={captions[beat][0]} keyword={captions[beat][1]} />
  </VFrame>;
};

const Root = () => (
  <>
    <Composition id="PosecodeCut2" component={Cut2} durationInFrames={BEAT * 7} fps={FPS} width={1920} height={1080} />
    <Composition id="PosecodeCut2Vertical" component={VerticalCut2} durationInFrames={BEAT * 7} fps={FPS} width={1080} height={1920} />
  </>
);

registerRoot(Root);
