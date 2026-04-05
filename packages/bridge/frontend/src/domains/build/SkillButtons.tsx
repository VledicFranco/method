/**
 * SkillButtons — Row of optional skill invocation buttons above the input area.
 *
 * Buttons: [Debate] [Review] [Surface]
 * Small outlined buttons that trigger skill invocations via the backend
 * or (in mock mode) append a system message to the conversation.
 *
 * @see PRD 047 §Conversation Panel — Skill Invocation
 */

import { cn } from '@/shared/lib/cn';
import type { SkillType } from './types';

const SKILLS: { type: SkillType; label: string }[] = [
  { type: 'debate', label: 'Debate' },
  { type: 'review', label: 'Review' },
  { type: 'surface', label: 'Surface' },
];

export interface SkillButtonsProps {
  onSkill: (skill: SkillType) => void;
}

export function SkillButtons({ onSkill }: SkillButtonsProps) {
  return (
    <div className="flex gap-1 mb-2">
      {SKILLS.map((skill) => (
        <button
          key={skill.type}
          onClick={() => onSkill(skill.type)}
          className={cn(
            'bg-[#ffffff06] border border-bdr text-[#64748b] font-mono text-[10px] px-2.5 py-[3px] rounded-[3px] cursor-pointer transition-all duration-150',
            'hover:text-txt hover:border-[#6d5aed] hover:bg-[#6d5aed33]',
          )}
        >
          {skill.label}
        </button>
      ))}
    </div>
  );
}
