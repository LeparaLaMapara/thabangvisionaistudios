import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const title = searchParams.get('title') ?? 'ThabangVision';
  const subtitle = searchParams.get('subtitle') ?? '';
  const type = searchParams.get('type') ?? 'default';

  const accentColor = '#D4A843';
  const bgColor = '#050505';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: '60px 80px',
          backgroundColor: bgColor,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Top bar accent */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '6px',
            background: `linear-gradient(90deg, ${accentColor}, ${accentColor}88, transparent)`,
          }}
        />

        {/* Type badge */}
        {type !== 'default' && (
          <div
            style={{
              position: 'absolute',
              top: '50px',
              left: '80px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: accentColor,
              }}
            />
            <span
              style={{
                fontSize: '16px',
                color: '#888',
                textTransform: 'uppercase',
                letterSpacing: '4px',
              }}
            >
              {type}
            </span>
          </div>
        )}

        {/* Title */}
        <div
          style={{
            fontSize: title.length > 40 ? '52px' : '64px',
            fontWeight: 700,
            color: '#ffffff',
            lineHeight: 1.1,
            textTransform: 'uppercase',
            letterSpacing: '-1px',
            marginBottom: subtitle ? '16px' : '24px',
            maxWidth: '900px',
          }}
        >
          {title}
        </div>

        {/* Subtitle */}
        {subtitle && (
          <div
            style={{
              fontSize: '24px',
              color: '#999',
              marginBottom: '24px',
              maxWidth: '800px',
            }}
          >
            {subtitle}
          </div>
        )}

        {/* Bottom bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid #222',
            paddingTop: '24px',
            marginTop: '8px',
          }}
        >
          <div
            style={{
              fontSize: '20px',
              fontWeight: 700,
              color: accentColor,
              letterSpacing: '2px',
              textTransform: 'uppercase',
            }}
          >
            ThabangVision
          </div>
          <div
            style={{
              fontSize: '14px',
              color: '#666',
              letterSpacing: '2px',
              textTransform: 'uppercase',
            }}
          >
            thabangvision.com
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
