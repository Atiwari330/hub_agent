interface AEHeaderProps {
  firstName: string | null;
  lastName: string | null;
  email: string;
}

function getInitials(firstName: string | null, lastName: string | null, email: string): string {
  if (firstName && lastName) {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  }
  if (firstName) {
    return firstName.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function getFullName(firstName: string | null, lastName: string | null, email: string): string {
  if (firstName || lastName) {
    return [firstName, lastName].filter(Boolean).join(' ');
  }
  return email.split('@')[0];
}

// Generate a consistent color based on email
function getAvatarColor(email: string): string {
  const colors = [
    'bg-indigo-100 text-indigo-700',
    'bg-blue-100 text-blue-700',
    'bg-purple-100 text-purple-700',
    'bg-pink-100 text-pink-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-cyan-100 text-cyan-700',
  ];

  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

export function AEHeader({ firstName, lastName, email }: AEHeaderProps) {
  const initials = getInitials(firstName, lastName, email);
  const fullName = getFullName(firstName, lastName, email);
  const avatarColor = getAvatarColor(email);

  return (
    <div className="flex items-center gap-4 mb-8">
      {/* Avatar */}
      <div
        className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-semibold ${avatarColor}`}
      >
        {initials}
      </div>

      {/* Info */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{fullName}</h1>
        <p className="text-gray-500">
          Account Executive &bull; {email}
        </p>
      </div>
    </div>
  );
}
