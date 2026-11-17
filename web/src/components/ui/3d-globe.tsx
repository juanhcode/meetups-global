"use client";
import { useRef, useMemo, useState, useCallback, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Html, useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { cn } from "@/lib/utils";

// Basado en Globe3D de 21st.dev. Cambios: texturas locales con océano especular,
// puntos de datos en un InstancedMesh con agrupación según el zoom, foco animado,
// anillos de selección y controles de zoom.

// ============================================================================
// Types
// ============================================================================

/** Image marker (original 21st.dev API). Use for a handful of highlighted places. */
export interface GlobeMarker {
  lat: number;
  lng: number;
  src: string;
  label?: string;
  size?: number;
}

/** Data point. Thousands are fine: they render as one InstancedMesh and cluster by zoom. */
export interface GlobePoint {
  id: string;
  lat: number;
  lng: number;
  /** Importance used for size and for weighting merged clusters (e.g. meetups) */
  weight?: number;
  /** CSS color. Clusters take the color that carries the most weight. */
  color?: string;
  /** Faded points stay on the globe as context but can't be hovered */
  dimmed?: boolean;
}

/** What the hover/click callbacks receive: one point, or a cluster of them. */
export interface GlobeHit {
  lat: number;
  lng: number;
  ids: string[];
}

/** Where the camera should look. `distance` is a multiple of the radius. */
export interface GlobeFocus {
  lat: number;
  lng: number;
  distance?: number;
}

export interface Globe3DConfig {
  radius?: number;
  textureUrl?: string;
  bumpMapUrl?: string;
  /** Grayscale map, white = water: makes oceans catch the light */
  waterMapUrl?: string;
  bumpScale?: number;
  showAtmosphere?: boolean;
  atmosphereColor?: string;
  atmosphereIntensity?: number;
  atmosphereBlur?: number;
  autoRotateSpeed?: number;
  enableZoom?: boolean;
  enablePan?: boolean;
  /** Camera distance limits, in globe radii */
  minDistance?: number;
  maxDistance?: number;
  /** Starting camera distance, in globe radii */
  distance?: number;
  initialRotation?: { lat: number; lng: number };
  ambientIntensity?: number;
  sunIntensity?: number;
  pointColor?: string;
  pointOutline?: string;
  /** Base radius of a point (globe units at the default distance) */
  pointSize?: number;
  backgroundColor?: string | null;
}

interface Globe3DProps {
  markers?: GlobeMarker[];
  points?: GlobePoint[];
  config?: Globe3DConfig;
  className?: string;
  /** Animated camera target. null = free. */
  focus?: GlobeFocus | null;
  /** Places to mark with a pulsing ring */
  selected?: { lat: number; lng: number }[];
  /** Zoom +/- and reset buttons */
  showControls?: boolean;
  controlLabels?: { zoomIn: string; zoomOut: string; reset: string };
  onMarkerClick?: (marker: GlobeMarker) => void;
  onMarkerHover?: (marker: GlobeMarker | null) => void;
  /** Called for single points. Clusters zoom in on their own. */
  onPointClick?: (hit: GlobeHit) => void;
  onPointHover?: (hit: GlobeHit | null) => void;
}

// ============================================================================
// Utility Functions
// ============================================================================

export function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

function vectorToLatLng(v: THREE.Vector3): { lat: number; lng: number } {
  const n = v.clone().normalize();
  const lat = 90 - (Math.acos(n.y) * 180) / Math.PI;
  let lng = (Math.atan2(n.z, -n.x) * 180) / Math.PI - 180;
  if (lng < -180) lng += 360;
  return { lat, lng };
}

// ============================================================================
// Camera rig: focus, zoom buttons, fly-to (one owner for camera motion)
// ============================================================================

interface CameraApi {
  zoomBy: (factor: number) => void;
  flyTo: (lat: number, lng: number, distance: number) => void;
  reset: () => void;
  cancel: () => void;
}

interface Tween {
  q: THREE.Quaternion;          // rotación total de la dirección inicial a la final
  from: THREE.Vector3;          // dirección inicial (unitaria)
  fromDist: number;
  toDist: number;
  start: number;
  dur: number;
}

const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

function CameraRig({ focus, config, api, onEngage }: {
  focus?: GlobeFocus | null;
  config: Required<Globe3DConfig>;
  api: React.RefObject<CameraApi | null>;
  onEngage: () => void;
}) {
  const { camera, controls, clock } = useThree();
  const tween = useRef<Tween | null>(null);
  const R = config.radius;
  const clampDist = useCallback(
    (d: number) => THREE.MathUtils.clamp(d, config.minDistance * R, config.maxDistance * R),
    [config.minDistance, config.maxDistance, R],
  );

  /** Vuelo por un arco del globo; la duración crece con la distancia angular y el cambio de zoom. */
  const fly = useCallback((dir: THREE.Vector3 | null, dist: number) => {
    const from = camera.position.clone().normalize();
    const to = dir ?? from;
    const q = new THREE.Quaternion().setFromUnitVectors(from, to);
    const angle = from.angleTo(to);
    const zoomChange = Math.abs(Math.log(dist / camera.position.length()));
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    tween.current = {
      q, from, fromDist: camera.position.length(), toDist: dist, start: clock.elapsedTime,
      dur: reduce ? 0.01 : THREE.MathUtils.clamp(1.1 + angle * 0.75 + zoomChange * 0.9, 1.4, 2.8),
    };
  }, [camera, clock]);

  useEffect(() => {
    api.current = {
      zoomBy: (f) => { onEngage(); fly(null, clampDist(camera.position.length() * f)); },
      flyTo: (lat, lng, d) => { onEngage(); fly(latLngToVector3(lat, lng, 1).normalize(), clampDist(d * R)); },
      reset: () => fly(latLngToVector3(config.initialRotation.lat, config.initialRotation.lng, 1).normalize(), config.distance * R),
      cancel: () => { tween.current = null; },
    };
  }, [api, camera, clampDist, fly, config.distance, config.initialRotation.lat, config.initialRotation.lng, R, onEngage]);

  useEffect(() => {
    if (!focus) { fly(null, config.distance * R); return; }
    fly(latLngToVector3(focus.lat, focus.lng, 1).normalize(), clampDist((focus.distance ?? config.distance) * R));
  }, [focus, R, config.distance, clampDist, fly]);

  const ident = useMemo(() => new THREE.Quaternion(), []);
  const tmpQ = useMemo(() => new THREE.Quaternion(), []);

  useFrame(() => {
    const ctr = controls as OrbitControlsImpl | null;
    // Arrastre más lento cuanto más cerca está la cámara
    if (ctr) ctr.rotateSpeed = 0.42 * (camera.position.length() / R) / config.distance;
    const t = tween.current;
    if (!t) return;
    const k = Math.min(1, (clock.elapsedTime - t.start) / t.dur);
    const e = easeInOut(k);
    tmpQ.slerpQuaternions(ident, t.q, e);
    const dir = t.from.clone().applyQuaternion(tmpQ);
    // El zoom se resuelve un poco antes que el giro: se aleja/acerca con calma
    const dist = THREE.MathUtils.lerp(t.fromDist, t.toDist, easeInOut(Math.min(1, k * 1.08)));
    camera.position.copy(dir.multiplyScalar(dist));
    camera.lookAt(0, 0, 0);
    ctr?.update();
    if (k >= 1) tween.current = null;
  });

  return null;
}

// ============================================================================
// Data points with zoom-dependent clustering
// ============================================================================

interface Cluster extends GlobeHit {
  weight: number;
  dimmed: boolean;
  color?: string;
}

/** Celda de agrupación (grados) según la distancia de la cámara (en radios). */
function cellFor(dist: number) {
  if (dist > 3.4) return 7;
  if (dist > 2.7) return 4;
  if (dist > 2.1) return 2;
  if (dist > 1.6) return 0.9;
  return 0.35;
}

function clusterPoints(points: GlobePoint[], cell: number): Cluster[] {
  const bins = new Map<string, { pts: GlobePoint[]; dimmed: boolean }>();
  for (const p of points) {
    const row = Math.floor((p.lat + 90) / cell);
    const latC = -90 + (row + 0.5) * cell;
    const lngCell = cell / Math.max(0.2, Math.cos((latC * Math.PI) / 180));
    const col = Math.floor((p.lng + 180) / lngCell);
    // Los puntos atenuados no se mezclan con los activos
    const key = `${p.dimmed ? "d" : "a"}${row}:${col}`;
    let b = bins.get(key);
    if (!b) { b = { pts: [], dimmed: !!p.dimmed }; bins.set(key, b); }
    b.pts.push(p);
  }
  const out: Cluster[] = [];
  for (const { pts, dimmed } of bins.values()) {
    let w = 0;
    const v = new THREE.Vector3();
    for (const p of pts) {
      const pw = (p.weight ?? 1) + 1;
      v.add(latLngToVector3(p.lat, p.lng, 1).multiplyScalar(pw));
      w += pw;
    }
    const c = pts.length === 1 ? { lat: pts[0].lat, lng: pts[0].lng } : vectorToLatLng(v);
    // Color dominante por peso
    const byColor = new Map<string, number>();
    for (const p of pts) if (p.color) byColor.set(p.color, (byColor.get(p.color) ?? 0) + (p.weight ?? 0) + 1);
    const color = [...byColor.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    out.push({ ...c, ids: pts.map((p) => p.id), weight: pts.reduce((s, p) => s + (p.weight ?? 0), 0), dimmed, color });
  }
  return out;
}

interface PointsProps {
  points: GlobePoint[];
  radius: number;
  baseSize: number;
  color: string;
  outline: string;
  defaultDistance: number;
  onClick?: (hit: GlobeHit) => void;
  onHover?: (hit: GlobeHit | null) => void;
  onClusterClick: (c: Cluster, dist: number) => void;
}

function Points({ points, radius, baseSize, color, outline, defaultDistance, onClick, onHover, onClusterClick }: PointsProps) {
  const fillRef = useRef<THREE.InstancedMesh>(null);
  const ringRef = useRef<THREE.InstancedMesh>(null);
  const { camera } = useThree();
  const [cell, setCell] = useState(() => cellFor(defaultDistance));
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Cambia el nivel de agrupación solo cuando la distancia cruza un umbral
  useFrame(() => {
    const c = cellFor(camera.position.length() / radius);
    if (c !== cell) setCell(c);
  });

  const clusters = useMemo(() => clusterPoints(points, cell), [points, cell]);
  const maxW = useMemo(() => Math.max(1, ...clusters.map((c) => c.weight)), [clusters]);

  useEffect(() => {
    const fill = fillRef.current, ring = ringRef.current;
    if (!fill || !ring) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 0, 1), cFill = new THREE.Color(), cRing = new THREE.Color(outline);
    // Tamaño en pantalla casi constante: escala con la distancia de la cámara (se recalcula por nivel)
    const zoomScale = Math.max(0.32, camera.position.length() / radius / defaultDistance);
    clusters.forEach((c, i) => {
      const pos = latLngToVector3(c.lat, c.lng, radius * 1.002);
      q.setFromUnitVectors(up, pos.clone().normalize());
      const rel = Math.sqrt(c.weight / maxW);
      let r = baseSize * zoomScale * (c.dimmed ? 0.5 : 0.7 + rel * 1.15);
      if (hoverIdx === i) r *= 1.35;
      s.set(r, r, 1);
      m.compose(pos, q, s);
      fill.setMatrixAt(i, m);
      s.set(r * 1.28, r * 1.28, 1);
      m.compose(pos.clone().multiplyScalar(0.9995), q, s);
      ring.setMatrixAt(i, m);
      cFill.set(c.dimmed ? "#6b6b73" : c.color ?? color);
      fill.setColorAt(i, cFill);
      ring.setColorAt(i, cRing);
    });
    fill.count = ring.count = clusters.length;
    fill.instanceMatrix.needsUpdate = ring.instanceMatrix.needsUpdate = true;
    if (fill.instanceColor) fill.instanceColor.needsUpdate = true;
    if (ring.instanceColor) ring.instanceColor.needsUpdate = true;
    fill.computeBoundingSphere();
  }, [clusters, maxW, radius, baseSize, hoverIdx, color, outline, defaultDistance, camera]);

  useEffect(() => setHoverIdx(null), [clusters]);

  const handleMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const i = e.instanceId ?? null;
    const c = i === null ? null : clusters[i];
    if (c?.dimmed) return;
    if (i !== hoverIdx) {
      setHoverIdx(i);
      onHover?.(c ? { lat: c.lat, lng: c.lng, ids: c.ids } : null);
      document.body.style.cursor = c ? "pointer" : "";
    }
  }, [hoverIdx, clusters, onHover]);

  const handleOut = useCallback(() => {
    setHoverIdx(null);
    onHover?.(null);
    document.body.style.cursor = "";
  }, [onHover]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId == null) return;
    const c = clusters[e.instanceId];
    if (!c || c.dimmed) return;
    if (c.ids.length > 1 && cell > 0.35) onClusterClick(c, camera.position.length() / radius);
    else onClick?.({ lat: c.lat, lng: c.lng, ids: c.ids });
  }, [clusters, cell, camera, radius, onClick, onClusterClick]);

  const capacity = Math.max(1, points.length);
  return (
    <>
      <instancedMesh key={`ring-${capacity}`} ref={ringRef} args={[undefined, undefined, capacity]} raycast={() => null} renderOrder={1}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        key={`fill-${capacity}`}
        ref={fillRef}
        args={[undefined, undefined, capacity]}
        renderOrder={2}
        onPointerMove={handleMove}
        onPointerOut={handleOut}
        onClick={handleClick}
      >
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </>
  );
}

// ============================================================================
// Selected rings
// ============================================================================

function SelectedRings({ places, radius, color }: { places: { lat: number; lng: number }[]; radius: number; color: string }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const { camera } = useThree();
  const items = useMemo(() => places.slice(0, 40).map((p) => {
    const pos = latLngToVector3(p.lat, p.lng, radius * 1.003);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), pos.clone().normalize());
    return { pos, q };
  }), [places, radius]);

  useFrame(({ clock }) => {
    const k = (clock.elapsedTime * 0.7) % 1;
    const zoom = camera.position.length() / radius / 2.6;
    refs.current.forEach((m) => {
      if (!m) return;
      const sc = radius * zoom * (0.012 + k * 0.03);
      m.scale.set(sc, sc, sc);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    });
  });

  return (
    <>
      {items.map((it, i) => (
        <group key={i} position={it.pos} quaternion={it.q}>
          <mesh ref={(m) => { refs.current[i] = m; }} raycast={() => null} renderOrder={3}>
            <ringGeometry args={[0.8, 1, 48]} />
            <meshBasicMaterial color={color} transparent depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

// ============================================================================
// Image Marker (original behaviour; fine for a few markers)
// ============================================================================

function Marker({ marker, radius, onClick, onHover }: {
  marker: GlobeMarker; radius: number;
  onClick?: (marker: GlobeMarker) => void; onHover?: (marker: GlobeMarker | null) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const imageGroupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const surfacePosition = useMemo(() => latLngToVector3(marker.lat, marker.lng, radius * 1.001), [marker.lat, marker.lng, radius]);
  const topPosition = useMemo(() => latLngToVector3(marker.lat, marker.lng, radius * 1.18), [marker.lat, marker.lng, radius]);
  const lineHeight = topPosition.distanceTo(surfacePosition);

  useFrame(() => {
    if (!imageGroupRef.current) return;
    imageGroupRef.current.getWorldPosition(tmp);
    const visible = tmp.normalize().dot(camera.position.clone().normalize()) > 0.1;
    if (visible !== isVisible) setIsVisible(visible);
  });

  const { lineCenter, lineQuaternion } = useMemo(() => {
    const center = surfacePosition.clone().lerp(topPosition, 0.5);
    const direction = topPosition.clone().sub(surfacePosition).normalize();
    return { lineCenter: center, lineQuaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction) };
  }, [surfacePosition, topPosition]);

  return (
    <group visible={isVisible}>
      <mesh position={lineCenter} quaternion={lineQuaternion}>
        <cylinderGeometry args={[0.003, 0.003, lineHeight, 8]} />
        <meshBasicMaterial color={hovered ? "#ffffff" : "#94a3b8"} transparent opacity={hovered ? 0.9 : 0.6} />
      </mesh>
      <group ref={imageGroupRef} position={topPosition}>
        <Html transform center sprite distanceFactor={10} style={{ pointerEvents: isVisible ? "auto" : "none", opacity: isVisible ? 1 : 0 }}>
          <div
            className={cn("cursor-pointer overflow-hidden rounded-full bg-neutral-900 shadow-lg transition-transform duration-200", hovered && "scale-125")}
            style={{ width: "8px", height: "8px" }}
            onMouseEnter={() => { setHovered(true); onHover?.(marker); }}
            onMouseLeave={() => { setHovered(false); onHover?.(null); }}
            onClick={() => onClick?.(marker)}
          >
            <img src={marker.src} alt={marker.label || "Marker"} className="h-full w-full object-cover" draggable={false} />
          </div>
        </Html>
      </group>
    </group>
  );
}

// ============================================================================
// Earth
// ============================================================================

function Earth({ config }: { config: Required<Globe3DConfig> }) {
  const [map, bump, water] = useTexture([config.textureUrl, config.bumpMapUrl, config.waterMapUrl]);
  const { gl } = useThree();
  useMemo(() => {
    map.colorSpace = THREE.SRGBColorSpace;
    const aniso = gl.capabilities.getMaxAnisotropy();
    map.anisotropy = aniso;
    bump.anisotropy = aniso;
  }, [map, bump, gl]);
  const specular = useMemo(() => new THREE.Color("#222c36"), []);
  return (
    <mesh>
      <sphereGeometry args={[config.radius, 96, 96]} />
      <meshPhongMaterial
        map={map}
        bumpMap={bump}
        bumpScale={config.bumpScale * 0.01}
        specularMap={water}
        specular={specular}
        shininess={60}
      />
    </mesh>
  );
}

function Atmosphere({ radius, color, intensity, blur }: { radius: number; color: string; intensity: number; blur: number }) {
  const fresnelPower = Math.max(0.5, 5 - blur);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      atmosphereColor: { value: new THREE.Color(color) },
      intensity: { value: intensity },
      fresnelPower: { value: fresnelPower },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 atmosphereColor;
      uniform float intensity;
      uniform float fresnelPower;
      varying vec3 vNormal;
      varying vec3 vPosition;
      void main() {
        float fresnel = pow(1.0 - abs(dot(vNormal, normalize(-vPosition))), fresnelPower);
        gl_FragColor = vec4(atmosphereColor, fresnel * intensity);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  }), [color, intensity, fresnelPower]);

  return (
    <mesh scale={1.045} raycast={() => null}>
      <sphereGeometry args={[radius, 64, 32]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

// ============================================================================
// Scene
// ============================================================================

interface SceneProps {
  config: Required<Globe3DConfig>;
  markers: GlobeMarker[];
  points: GlobePoint[];
  selected: { lat: number; lng: number }[];
  focus?: GlobeFocus | null;
  api: React.RefObject<CameraApi | null>;
  onMarkerClick?: (marker: GlobeMarker) => void;
  onMarkerHover?: (marker: GlobeMarker | null) => void;
  onPointClick?: (hit: GlobeHit) => void;
  onPointHover?: (hit: GlobeHit | null) => void;
}

function Scene({ config, markers, points, selected, focus, api, ...cb }: SceneProps) {
  const { camera } = useThree();
  const [engaged, setEngaged] = useState(false);
  const engage = useCallback(() => setEngaged(true), []);
  const R = config.radius;

  useEffect(() => {
    camera.position.copy(latLngToVector3(config.initialRotation.lat, config.initialRotation.lng, config.distance * R));
    camera.lookAt(0, 0, 0);
  }, [camera, R, config.distance, config.initialRotation.lat, config.initialRotation.lng]);

  // El sol sigue a la cámara (desde arriba a la izquierda): la cara visible siempre está iluminada
  const sun = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    if (!sun.current) return;
    const off = new THREE.Vector3(-1.1, 0.8, 0).applyQuaternion(camera.quaternion);
    sun.current.position.copy(camera.position).add(off.multiplyScalar(camera.position.length()));
  });

  return (
    <>
      <ambientLight intensity={config.ambientIntensity} />
      <directionalLight ref={sun} intensity={config.sunIntensity} color="#fffaf0" />

      <group>
        <Earth config={config} />
        <SelectedRings places={selected} radius={R} color="#ffffff" />
        <Points
          points={points}
          radius={R}
          baseSize={config.pointSize}
          color={config.pointColor}
          outline={config.pointOutline}
          defaultDistance={config.distance}
          onClick={cb.onPointClick}
          onHover={cb.onPointHover}
          onClusterClick={(c, d) => api.current?.flyTo(c.lat, c.lng, Math.max(config.minDistance, d * 0.62))}
        />
        {markers.map((marker, index) => (
          <Marker key={`marker-${index}-${marker.lat}-${marker.lng}`} marker={marker} radius={R} onClick={cb.onMarkerClick} onHover={cb.onMarkerHover} />
        ))}
      </group>

      {config.showAtmosphere && (
        <Atmosphere radius={R} color={config.atmosphereColor} intensity={config.atmosphereIntensity} blur={config.atmosphereBlur} />
      )}

      <CameraRig focus={focus} config={config} api={api} onEngage={engage} />

      <OrbitControls
        makeDefault
        enablePan={config.enablePan}
        enableZoom={config.enableZoom}
        minDistance={config.minDistance * R}
        maxDistance={config.maxDistance * R}
        rotateSpeed={0.42}
        autoRotate={config.autoRotateSpeed > 0 && !engaged && !focus}
        autoRotateSpeed={config.autoRotateSpeed}
        enableDamping
        dampingFactor={0.06}
        onStart={() => { api.current?.cancel(); engage(); }}
      />
    </>
  );
}

const defaultConfig: Required<Globe3DConfig> = {
  radius: 2,
  textureUrl: "/textures/earth.jpg",
  bumpMapUrl: "/textures/bump.png",
  waterMapUrl: "/textures/water.png",
  bumpScale: 1,
  showAtmosphere: true,
  atmosphereColor: "#8fc3ff",
  atmosphereIntensity: 0.6,
  atmosphereBlur: 1.5,
  autoRotateSpeed: 0.3,
  enableZoom: false,
  enablePan: false,
  minDistance: 1.35,
  maxDistance: 4,
  distance: 2.6,
  initialRotation: { lat: 15, lng: -40 },
  ambientIntensity: 1.1,
  sunIntensity: 1.6,
  pointColor: "#e3af35",
  pointOutline: "#0b0b0d",
  pointSize: 0.022,
  backgroundColor: null,
};

function ControlButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-9 place-items-center text-neutral-200 transition-colors hover:bg-white/10 hover:text-white active:scale-95"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}

export function Globe3D({
  markers = [],
  points = [],
  config = {},
  className,
  focus,
  selected = [],
  showControls = false,
  controlLabels = { zoomIn: "Zoom in", zoomOut: "Zoom out", reset: "Show the whole globe" },
  onMarkerClick,
  onMarkerHover,
  onPointClick,
  onPointHover,
}: Globe3DProps) {
  const mergedConfig = useMemo(() => ({ ...defaultConfig, ...config }), [config]);
  const api = useRef<CameraApi | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);

  // Solo dibuja mientras el globo está en pantalla y la pestaña visible: fuera de vista no gasta GPU
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let onScreen = true;
    const update = () => setActive(onScreen && document.visibilityState === "visible");
    const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; update(); }, { rootMargin: "80px" });
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);

  return (
    <div ref={wrap} className={cn("relative h-[500px] w-full", className)}>
      <Canvas
        frameloop={active ? "always" : "never"}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        dpr={[1, 1.5]}
        camera={{ fov: 40, near: 0.1, far: 1000, position: [0, 0, mergedConfig.radius * mergedConfig.distance] }}
        style={{ background: mergedConfig.backgroundColor || "transparent", touchAction: "pan-y" }}
      >
        <Suspense fallback={null}>
          <Scene
            config={mergedConfig}
            markers={markers}
            points={points}
            selected={selected}
            focus={focus}
            api={api}
            onMarkerClick={onMarkerClick}
            onMarkerHover={onMarkerHover}
            onPointClick={onPointClick}
            onPointHover={onPointHover}
          />
        </Suspense>
      </Canvas>
      {showControls && (
        <div className="absolute right-4 bottom-4 flex flex-col divide-y lg:bottom-6 divide-white/10 overflow-hidden rounded-xl border border-white/12 bg-[#1b1b20] shadow-[0_10px_30px_-10px_rgb(0_0_0/0.6)]">
          <ControlButton label={controlLabels.zoomIn} onClick={() => api.current?.zoomBy(0.72)}>
            <path d="M12 5v14M5 12h14" />
          </ControlButton>
          <ControlButton label={controlLabels.zoomOut} onClick={() => api.current?.zoomBy(1.38)}>
            <path d="M5 12h14" />
          </ControlButton>
          <ControlButton label={controlLabels.reset} onClick={() => api.current?.reset()}>
            <circle cx="12" cy="12" r="8" />
            <path d="M4 12h16M12 4a12 12 0 0 1 0 16M12 4a12 12 0 0 0 0 16" />
          </ControlButton>
        </div>
      )}
    </div>
  );
}

export default Globe3D;
