import { useTelegram } from '@/contexts/TelegramContext';
import { Navigate, Outlet } from 'react-router-dom';

export function MiniAppLayout() {
  const { isInTelegram, user } = useTelegram();

  // For development, allow access without Telegram
  const isDev = import.meta.env.DEV;

  if (!isInTelegram && !isDev) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            🔐 Telegram လိုအပ်သည်
          </h1>
          <p className="text-muted-foreground">
            ဒီ Mini App ကို Telegram ထဲကနေဖွင့်ပါ
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Outlet />
    </div>
  );
}
