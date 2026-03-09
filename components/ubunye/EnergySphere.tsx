'use client';

import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';

type EnergyLevel = 'idle' | 'pulse' | 'calm';

interface EnergySphereProps {
  energyLevel: EnergyLevel;
  className?: string;
}

const PARTICLE_COUNT = 2000;
const SPHERE_RADIUS = 2.5;
const ARC_COUNT = 6;

export function EnergySphere({ energyLevel, className = '' }: EnergySphereProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);
  const arcsRef = useRef<THREE.Line[]>([]);
  const coreRef = useRef<THREE.Mesh | null>(null);
  const glowRef = useRef<THREE.Mesh | null>(null);
  const rafRef = useRef(0);
  const energyRef = useRef<EnergyLevel>('idle');
  const pulseIntensityRef = useRef(0);

  // Keep energy level in sync via ref to avoid re-creating the animation loop
  useEffect(() => {
    energyRef.current = energyLevel;
    if (energyLevel === 'pulse') {
      pulseIntensityRef.current = 1.0;
    }
  }, [energyLevel]);

  const init = useCallback(() => {
    if (!containerRef.current) return;

    const w = containerRef.current.clientWidth;
    const h = containerRef.current.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
    camera.position.z = 7;
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ── Particles ──
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);

    const gold = new THREE.Color(0xD4A843);
    const white = new THREE.Color(0xFFFFFF);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Distribute on sphere surface with some depth variation
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      const r = SPHERE_RADIUS * (0.8 + Math.random() * 0.4);

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      // Mix gold and white
      const mix = Math.random();
      const c = gold.clone().lerp(white, mix * 0.3);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;

      sizes[i] = 1.5 + Math.random() * 2.5;

      // Orbital velocities
      velocities[i * 3] = (Math.random() - 0.5) * 0.002;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.002;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.002;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Store velocities for animation
    (geometry as unknown as Record<string, unknown>)._velocities = velocities;

    const particleMaterial = new THREE.PointsMaterial({
      size: 0.04,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const particles = new THREE.Points(geometry, particleMaterial);
    scene.add(particles);
    particlesRef.current = particles;

    // ── Core glow ──
    const coreGeom = new THREE.SphereGeometry(0.6, 32, 32);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xD4A843,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    scene.add(core);
    coreRef.current = core;

    // Outer glow
    const glowGeom = new THREE.SphereGeometry(1.2, 32, 32);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xD4A843,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    scene.add(glow);
    glowRef.current = glow;

    // ── Arc lightning ──
    const arcs: THREE.Line[] = [];
    for (let a = 0; a < ARC_COUNT; a++) {
      const arcGeom = new THREE.BufferGeometry();
      const arcPositions = new Float32Array(30 * 3); // 30 points per arc
      arcGeom.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3));

      const arcMat = new THREE.LineBasicMaterial({
        color: 0xD4A843,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
      });

      const arc = new THREE.Line(arcGeom, arcMat);
      scene.add(arc);
      arcs.push(arc);
    }
    arcsRef.current = arcs;
  }, []);

  const animate = useCallback(() => {
    const time = performance.now() * 0.001;
    const particles = particlesRef.current;
    const core = coreRef.current;
    const glow = glowRef.current;
    const arcs = arcsRef.current;

    // Breathing factor
    const breath = Math.sin(time * 0.8) * 0.5 + 0.5;

    // Pulse decay
    if (pulseIntensityRef.current > 0) {
      pulseIntensityRef.current *= 0.97;
      if (pulseIntensityRef.current < 0.01) pulseIntensityRef.current = 0;
    }

    const energy = energyRef.current;
    const pulseBoost = pulseIntensityRef.current;

    // ── Update particles ──
    if (particles) {
      const positions = particles.geometry.attributes.position.array as Float32Array;
      const velocities = (particles.geometry as unknown as Record<string, unknown>)._velocities as Float32Array;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        let x = positions[i3];
        let y = positions[i3 + 1];
        let z = positions[i3 + 2];

        // Add velocity
        x += velocities[i3];
        y += velocities[i3 + 1];
        z += velocities[i3 + 2];

        // Constrain to sphere
        const dist = Math.sqrt(x * x + y * y + z * z);
        const targetR = SPHERE_RADIUS * (1 + breath * 0.1 + pulseBoost * 0.3);
        if (dist > 0) {
          const factor = 0.001 * (targetR - dist);
          x += (x / dist) * factor;
          y += (y / dist) * factor;
          z += (z / dist) * factor;
        }

        positions[i3] = x;
        positions[i3 + 1] = y;
        positions[i3 + 2] = z;
      }

      particles.geometry.attributes.position.needsUpdate = true;
      particles.rotation.y += 0.002;
      particles.rotation.x += 0.0005;

      const mat = particles.material as THREE.PointsMaterial;
      mat.opacity = 0.6 + breath * 0.2 + pulseBoost * 0.4;
    }

    // ── Core breathing ──
    if (core) {
      const scale = 1 + breath * 0.15 + pulseBoost * 0.5;
      core.scale.setScalar(scale);
      (core.material as THREE.MeshBasicMaterial).opacity = 0.3 + breath * 0.2 + pulseBoost * 0.5;
    }

    // ── Outer glow ──
    if (glow) {
      const scale = 1 + breath * 0.1 + pulseBoost * 0.3;
      glow.scale.setScalar(scale);
      (glow.material as THREE.MeshBasicMaterial).opacity = 0.05 + breath * 0.05 + pulseBoost * 0.15;
    }

    // ── Arc lightning ──
    arcs.forEach((arc, idx) => {
      const arcPositions = arc.geometry.attributes.position.array as Float32Array;
      const baseAngle = (idx / ARC_COUNT) * Math.PI * 2 + time * 0.5;
      const arcPhase = time * 2 + idx * 1.3;

      // Only show arcs periodically (flickering effect)
      const visible = Math.sin(arcPhase) > -0.3;
      (arc.material as THREE.LineBasicMaterial).opacity = visible
        ? (0.3 + pulseBoost * 0.7) * (Math.sin(arcPhase) * 0.5 + 0.5)
        : 0;

      const points = 30;
      for (let p = 0; p < points; p++) {
        const t = p / (points - 1);
        const r = SPHERE_RADIUS * (0.4 + t * 0.8);
        const angle = baseAngle + t * 1.5;
        const jitter = visible ? (Math.random() - 0.5) * 0.3 * (1 + pulseBoost * 2) : 0;

        arcPositions[p * 3] = r * Math.cos(angle) + jitter;
        arcPositions[p * 3 + 1] = r * Math.sin(angle * 0.7 + time) + jitter;
        arcPositions[p * 3 + 2] = r * Math.sin(angle) * 0.5 + jitter;
      }

      arc.geometry.attributes.position.needsUpdate = true;
    });

    // Render
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }

    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    init();
    rafRef.current = requestAnimationFrame(animate);

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      rendererRef.current.setSize(w, h);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
    };
  }, [init, animate]);

  return <div ref={containerRef} className={className} />;
}
