import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { Link } from 'react-router';

/** Lets Astryx components (SideNavItem, Button href, Link) navigate client-side. */
export const RouterLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string }>(function RouterLink(
  { href = '#', ...rest },
  ref,
) {
  if (/^(https?:|mailto:|tel:)/.test(href) || rest.target === '_blank') return <a ref={ref} href={href} {...rest} />;
  return <Link ref={ref} to={href} {...rest} />;
});
