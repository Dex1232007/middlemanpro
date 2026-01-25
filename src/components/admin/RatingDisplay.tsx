import { Star, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface RatingDisplayProps {
  rating: number | null;
  comment?: string | null;
  size?: 'sm' | 'md';
  showEmpty?: boolean;
  showComment?: boolean;
}

export function RatingDisplay({ rating, comment, size = 'sm', showEmpty = true, showComment = true }: RatingDisplayProps) {
  if (rating === null || rating === undefined) {
    if (!showEmpty) return null;
    return (
      <span className="text-muted-foreground text-xs">-</span>
    );
  }

  const stars = Array.from({ length: 5 }, (_, i) => i + 1);
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';

  const starsDisplay = (
    <div className="flex items-center gap-0.5">
      {stars.map((star) => (
        <Star
          key={star}
          className={cn(
            iconSize,
            star <= rating
              ? 'fill-amber-400 text-amber-400'
              : 'text-muted-foreground/30'
          )}
        />
      ))}
    </div>
  );

  // Show comment inline below stars
  if (comment && showComment) {
    return (
      <div className="flex flex-col gap-1">
        {starsDisplay}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-start gap-1 cursor-pointer max-w-[200px]">
                <MessageSquare className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                <span className="text-xs text-muted-foreground line-clamp-2 italic">
                  "{comment.length > 50 ? comment.substring(0, 50) + '...' : comment}"
                </span>
              </div>
            </TooltipTrigger>
            {comment.length > 50 && (
              <TooltipContent className="max-w-xs">
                <p className="text-sm">"{comment}"</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  }

  return starsDisplay;
}

interface RatingSummaryProps {
  avgRating: number | null;
  totalRatings: number | null;
  size?: 'sm' | 'md';
}

export function RatingSummary({ avgRating, totalRatings, size = 'sm' }: RatingSummaryProps) {
  if (!avgRating || !totalRatings) {
    return <span className="text-muted-foreground text-xs">အဆင့်သတ်မှတ်မှုမရှိသေး</span>;
  }

  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div className="flex items-center gap-1.5">
      <Star className={cn(iconSize, 'fill-amber-400 text-amber-400')} />
      <span className={cn(textSize, 'font-medium')}>{avgRating.toFixed(1)}</span>
      <span className={cn(textSize, 'text-muted-foreground')}>({totalRatings})</span>
    </div>
  );
}
