import React, { useId } from 'react';

interface AdLensLogoProps {
  className?: string;
  title?: string;
}

export const AdLensLogo: React.FC<AdLensLogoProps> = ({
  className = 'w-8 h-8',
  title = 'AdLens',
}) => {
  const uid = useId().replace(/:/g, '');
  const blueGradId = `adlens-arc-blue-${uid}`;
  const tealGradId = `adlens-arc-teal-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
    >
      <defs>
        <linearGradient
          id={blueGradId}
          x1="80"
          y1="380"
          x2="396"
          y2="106"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#3378FF" />
          <stop offset="50%" stopColor="#5168F4" />
          <stop offset="100%" stopColor="#2E90FA" />
        </linearGradient>
        <linearGradient
          id={tealGradId}
          x1="445"
          y1="198"
          x2="201"
          y2="453"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#00B6A7" />
          <stop offset="100%" stopColor="#14B37B" />
        </linearGradient>
      </defs>
      {/* Top-left blue arc */}
      <path
        d="M 156 435 A 205 205 0 1 1 396 106"
        stroke={`url(#${blueGradId})`}
        strokeWidth="52"
        strokeLinecap="round"
      />
      {/* Bottom-right teal-green arc */}
      <path
        d="M 451 193 A 205 205 0 0 1 201 453"
        stroke={`url(#${tealGradId})`}
        strokeWidth="52"
        strokeLinecap="round"
      />
      {/* Central 'A' chevron */}
      <path
        d="M 177 326 L 256 162 L 335 326"
        stroke="#34B3E7"
        strokeWidth="56"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Orange lens dot */}
      <circle cx="256" cy="282" r="40" fill="#F79307" />
    </svg>
  );
};
