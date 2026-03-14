import React, { useState } from "react";

const loadingStyle: React.CSSProperties = {
  fontFamily: '"Noto Sans", sans-serif',
  fontWeight: 100,
  fontStyle: "italic",
};

interface ImageWithLoadingProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  /** When false, container grows with image (e.g. in a flow layout). Default true for aspect-ratio boxes. */
  fillHeight?: boolean;
}

export function ImageWithLoading({ src, alt, className = "", fillHeight = true, ...props }: ImageWithLoadingProps) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={`relative w-full min-h-[80px] flex items-center justify-center bg-gray-100 ${fillHeight ? "h-full" : ""}`}>
      {!loaded && (
        <span
          className="absolute inset-0 flex items-center justify-center text-gray-400 text-lg"
          style={loadingStyle}
        >
          loading
        </span>
      )}
      <img
        src={src}
        alt={alt}
        className={`${className} ${!loaded ? "opacity-0 absolute" : "opacity-100"} transition-opacity duration-200`}
        onLoad={() => setLoaded(true)}
        {...props}
      />
    </div>
  );
}

interface VideoWithLoadingProps extends React.VideoHTMLAttributes<HTMLVideoElement> {
  src: string;
  fillHeight?: boolean;
}

export function VideoWithLoading({ src, className = "", fillHeight = true, ...props }: VideoWithLoadingProps) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={`relative w-full min-h-[80px] flex items-center justify-center bg-gray-100 ${fillHeight ? "h-full" : ""}`}>
      {!loaded && (
        <span
          className="absolute inset-0 flex items-center justify-center text-gray-400 text-lg"
          style={loadingStyle}
        >
          loading
        </span>
      )}
      <video
        src={src}
        className={`${className} ${!loaded ? "opacity-0 absolute" : "opacity-100"} transition-opacity duration-200`}
        onLoadedData={() => setLoaded(true)}
        {...props}
      />
    </div>
  );
}
