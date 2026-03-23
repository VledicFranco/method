import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, ChevronUp } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

interface GenesisFABProps {
  onToggle: (isOpen: boolean) => void;
  isOpen: boolean;
  status: 'active' | 'idle';
}

// F-P-11: Cache rotation calculation
const computeRotationTransform = (isOpen: boolean, position: { x: number; y: number }): string => {
  return `translate(${position.x}px, ${position.y}px) rotate(${isOpen ? 45 : 0}deg)`;
};

export function GenesisFAB({ onToggle, isOpen, status }: GenesisFABProps) {
  const fabRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    // Load position from localStorage
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
  // F-P-11: Memoized transform string
  const transformStyle = computeRotationTransform(isOpen, position);

  // Handle drag start
  const handleMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
    setIsDragging(true);
    const rect = fabRef.current?.getBoundingClientRect();
    if (rect) {
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  };

  // Handle mouse move while dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!fabRef.current) return;
      const newX = e.clientX - dragOffset.x - window.innerWidth + 60;
      const newY = e.clientY - dragOffset.y - window.innerHeight + 60;
      setPosition({ x: Math.min(0, newX), y: Math.min(0, newY) });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      // Save position to localStorage
      localStorage.setItem('genesis-fab-position', JSON.stringify(position));
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, position]);

  const handleToggle = () => {
    onToggle(!isOpen);
  };

  const statusColor = status === 'active' ? 'bg-bio' : 'bg-txt-dim';

  return (
    <button
      ref={fabRef}
      onMouseDown={handleMouseDown}
      onClick={handleToggle}
      className={cn(
        'fixed bottom-sp-4 right-sp-4 h-14 w-14 rounded-full shadow-lg',
        'flex items-center justify-center gap-2',
        'transition-all duration-300 ease-out',
        'hover:scale-110 active:scale-95',
        'bg-bio text-void',
        'cursor-grab active:cursor-grabbing',
        isOpen && 'rotate-45',
      )}
      style={{
        transform: transformStyle,
      }}
      title={status === 'active' ? 'Genesis is active' : 'Genesis is idle'}
    >
      {/* Status indicator */}
      <div
        className={cn(
          'absolute top-1 right-1 h-3 w-3 rounded-full',
          'border border-void',
          statusColor,
          status === 'active' && 'animate-pulse',
        )}
      />

      {/* Icon */}
      {!isOpen ? (
        <MessageCircle className="h-6 w-6" />
      ) : (
        <ChevronUp className="h-6 w-6" />
      )}
    </button>
  );
}
