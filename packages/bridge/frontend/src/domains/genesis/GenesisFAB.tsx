import { useState, useRef, useEffect } from 'react';
import { MessageCircle, ChevronUp } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useGenesisStore } from '@/shared/stores/genesis-store';
import { useIsMobile } from './useIsMobile';

// F-P-11: Cache rotation calculation (desktop only — mobile has no drag offset)
const computeRotationTransform = (isOpen: boolean, position: { x: number; y: number }): string => {
  return `translate(${position.x}px, ${position.y}px) rotate(${isOpen ? 45 : 0}deg)`;
};

export function GenesisFAB() {
  const isOpen = useGenesisStore((s) => s.isOpen);
  const status = useGenesisStore((s) => s.status);
  const setOpen = useGenesisStore((s) => s.setOpen);
  const isMobile = useIsMobile();

  const fabRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const saved = localStorage.getItem('genesis-fab-position');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return { x: 0, y: 0 };
      }
    }
    return { x: 0, y: 0 };
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // F-P-11: Memoized transform string (desktop only)
  const transformStyle = isMobile ? undefined : computeRotationTransform(isOpen, position);

  // Handle drag start — desktop only
  const handleMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isMobile) return;
    setIsDragging(true);
    const rect = fabRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  };

  // Handle mouse move while dragging — desktop only
  useEffect(() => {
    if (!isDragging || isMobile) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!fabRef.current) return;
      const newX = e.clientX - dragOffset.x - window.innerWidth + 60;
      const newY = e.clientY - dragOffset.y - window.innerHeight + 60;
      setPosition({ x: Math.min(0, newX), y: Math.min(0, newY) });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      localStorage.setItem('genesis-fab-position', JSON.stringify(position));
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isMobile, dragOffset, position]);

  const handleToggle = () => {
    setOpen(!isOpen);
  };

  const isDisconnected = status === 'disconnected';
  const statusColor = isDisconnected
    ? 'bg-error'
    : status === 'active'
      ? 'bg-bio'
      : 'bg-txt-dim';

  return (
    <button
      ref={fabRef}
      onMouseDown={handleMouseDown}
      onClick={handleToggle}
      className={cn(
        'fixed bottom-sp-4 right-sp-4 rounded-full shadow-lg',
        'flex items-center justify-center gap-2',
        'transition-all duration-300 ease-out',
        'hover:scale-110 active:scale-95',
        // Disconnected: dimmed appearance
        isDisconnected ? 'bg-txt-muted/60 text-void' : 'bg-bio text-void',
        // Desktop: 56px, draggable
        !isMobile && 'h-14 w-14 cursor-grab active:cursor-grabbing',
        // Mobile: 48px, fixed position, no drag cursor
        isMobile && 'h-12 w-12 cursor-pointer',
        isOpen && !isMobile && 'rotate-45',
      )}
      style={
        isMobile
          ? { transform: `rotate(${isOpen ? 45 : 0}deg)` }
          : { transform: transformStyle }
      }
      title={
        isDisconnected
          ? 'Bridge disconnected'
          : status === 'active'
            ? 'Genesis is active'
            : 'Genesis is idle'
      }
    >
      {/* Status indicator */}
      <div
        className={cn(
          'absolute top-1 right-1 rounded-full',
          'border border-void',
          statusColor,
          status === 'active' && 'animate-pulse',
          isMobile ? 'h-2.5 w-2.5' : 'h-3 w-3',
        )}
      />

      {/* Icon */}
      {!isOpen ? (
        <MessageCircle className={cn(isMobile ? 'h-5 w-5' : 'h-6 w-6')} />
      ) : (
        <ChevronUp className={cn(isMobile ? 'h-5 w-5' : 'h-6 w-6')} />
      )}
    </button>
  );
}
