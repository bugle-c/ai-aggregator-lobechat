/**
 * /upload?attach_to=<topicId>&from=tg
 *
 * Bot file upload landing page. The user arrives here via the bot-bridge consume
 * redirect (already authenticated). They pick a file, it's POSTed to
 * /api/files/attach-to-topic, and the bot sends a push confirming the upload.
 */

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { type FC } from 'react';

import UploadForm from './_components/UploadForm';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ attach_to?: string; from?: string }>;
}

const UploadPage: FC<Props> = async ({ searchParams }) => {
  const { attach_to: topicId } = await searchParams;

  // --- Auth ---
  const { auth } = await import('@/auth');
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });

  if (!session?.user?.id) {
    redirect('/login');
  }

  if (!topicId) {
    return (
      <div
        style={{ fontFamily: 'sans-serif', maxWidth: 480, margin: '80px auto', padding: '0 16px' }}
      >
        <h2>Ошибка</h2>
        <p>Параметр <code>attach_to</code> не указан. Перейдите по корректной ссылке из бота.</p>
      </div>
    );
  }

  return <UploadForm topicId={topicId} />;
};

export default UploadPage;
