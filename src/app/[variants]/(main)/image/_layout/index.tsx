'use client';

import { type FC } from 'react';
import { Outlet } from 'react-router-dom';

import RegisterHotkeys from './RegisterHotkeys';

const Layout: FC = () => (
  <>
    <Outlet />
    <RegisterHotkeys />
  </>
);

export default Layout;
