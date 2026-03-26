Update the hero section to support both image and video backgrounds, controlled from constants.ts.

1. Update STUDIO in lib/constants.ts:

   hero: {
     type: 'image' as const,  // change to 'video' to switch
     imageSrc: 'current-hero-image-url-here',
     videoSrc: '',  // Cloudinary video URL when ready
     mobileVideoSrc: '',  // smaller video for mobile
     poster: '',  // image shown while video loads
   },

2. Update the hero section component:

   const { hero } = STUDIO;

   {hero.type === 'video' && hero.videoSrc ? (
     <>
       {/* Desktop video */}
       <video
         autoPlay
         loop
         muted
         playsInline
         poster={hero.poster || undefined}
         className="absolute inset-0 w-full h-full object-cover hidden md:block"
       >
         <source src={hero.videoSrc} type="video/mp4" />
       </video>
       
       {/* Mobile video (smaller file) or fallback to same */}
       <video
         autoPlay
         loop
         muted
         playsInline
         poster={hero.poster || undefined}
         className="absolute inset-0 w-full h-full object-cover md:hidden"
       >
         <source src={hero.mobileVideoSrc || hero.videoSrc} type="video/mp4" />
       </video>
     </>
   ) : (
     <Image
       src={hero.imageSrc}
       alt="ThabangVision Labs"
       fill
       className="object-cover"
       priority
     />
   )}

   {/* Dark overlay — always on top of both image and video */}
   <div className="absolute inset-0 bg-gradient-to-b from-[#050505]/70 via-[#050505]/50 to-[#050505]" />

3. Rules:
   - To use image: set type to 'image' — nothing else changes
   - To use video: set type to 'video' and add videoSrc
   - No controls visible — purely background
   - Video must be muted (required for autoplay on all browsers)
   - playsInline required for iOS (prevents fullscreen)
   - poster shows a static image while video loads
   - Dark overlay ensures text is always readable
   - No JavaScript needed — pure HTML5 video