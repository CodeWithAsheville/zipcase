import { useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, TransitionChild } from '@headlessui/react';
import {
    ArrowTopRightOnSquareIcon,
    Bars3Icon,
    Cog6ToothIcon,
    MagnifyingGlassIcon,
    QuestionMarkCircleIcon,
    UsersIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'aws-amplify/auth';
import ZipCaseLogo from '../../assets/ZipCaseLogo.svg';

const navigationItems = [
    { name: 'Search', href: '/search', icon: MagnifyingGlassIcon, current: true },
    { name: 'Clients', href: '/clients', icon: UsersIcon, current: false },
    { name: 'Settings', href: '/settings', icon: Cog6ToothIcon, current: false },
    { name: 'Help', href: '/help', icon: QuestionMarkCircleIcon, current: false },
];

function classNames(...classes: (string | boolean | undefined)[]) {
    return classes.filter(Boolean).join(' ');
}

const Shell: React.FC = () => {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();

    const handleSignOut = async () => {
        try {
            await signOut();
            // After signing out, navigate to the root which will redirect to login
            navigate('/');
        } catch (error) {
            console.error('Error signing out:', error);
        }
    };

    const navigation = navigationItems.map(item => ({
        ...item,
        current: item.href === location.pathname,
    }));

    return (
        <>
            <div>
                <Dialog
                    open={sidebarOpen}
                    onClose={setSidebarOpen}
                    className="relative z-50 lg:hidden"
                >
                    <DialogBackdrop
                        transition
                        className="fixed inset-0 bg-gray-900/80 transition-opacity duration-300 ease-linear data-closed:opacity-0"
                    />

                    <div className="fixed inset-0 flex">
                        <DialogPanel
                            transition
                            className="relative mr-16 flex w-full max-w-xs flex-1 transform transition duration-300 ease-in-out data-closed:-translate-x-full"
                        >
                            <TransitionChild>
                                <div className="absolute top-0 left-full flex w-16 justify-center pt-5 duration-300 ease-in-out data-closed:opacity-0">
                                    <button
                                        type="button"
                                        onClick={() => setSidebarOpen(false)}
                                        className="-m-2.5 p-2.5"
                                    >
                                        <span className="sr-only">Close sidebar</span>
                                        <XMarkIcon
                                            aria-hidden="true"
                                            className="size-6 text-white"
                                        />
                                    </button>
                                </div>
                            </TransitionChild>
                            {/* Sidebar component, swap this element with another sidebar if you like */}
                            <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-white px-6 pb-2">
                                <div className="flex h-16 shrink-0 items-center">
                                    <img
                                        alt="ZipCase Logo"
                                        src={ZipCaseLogo}
                                        className="h-8 w-auto"
                                    />
                                </div>
                                <nav className="flex flex-1 flex-col">
                                    <ul role="list" className="flex flex-1 flex-col gap-y-7">
                                        <li>
                                            <ul role="list" className="-mx-2 space-y-1">
                                                {navigation.map(item => (
                                                    <li key={item.name}>
                                                        <Link
                                                            to={item.href}
                                                            className={classNames(
                                                                item.current
                                                                    ? 'bg-gray-50 text-primary'
                                                                    : 'text-gray-700 hover:bg-gray-50 hover:text-primary',
                                                                'group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold focus:outline-none focus:ring-2 focus:ring-primary-dark'
                                                            )}
                                                        >
                                                            <item.icon
                                                                aria-hidden="true"
                                                                className={classNames(
                                                                    item.current
                                                                        ? 'text-primary'
                                                                        : 'text-gray-400 group-hover:text-primary',
                                                                    'size-6 shrink-0'
                                                                )}
                                                            />
                                                            {item.name} {item.current}
                                                        </Link>
                                                    </li>
                                                ))}
                                            </ul>
                                        </li>
                                    </ul>
                                </nav>
                                <div className="mt-auto pb-6">
                                    <button
                                        onClick={handleSignOut}
                                        className={classNames(
                                            'bg-gray-50 text-gray-700 hover:bg-gray-50 hover:text-primary group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold focus:outline-none focus:ring-2 focus:ring-primary-dark w-full'
                                        )}
                                    >
                                        <ArrowTopRightOnSquareIcon
                                            aria-hidden="true"
                                            className={classNames(
                                                'text-gray-400 group-hover:text-primary',
                                                'size-6 shrink-0'
                                            )}
                                        />
                                        Sign out
                                    </button>
                                </div>
                            </div>
                        </DialogPanel>
                    </div>
                </Dialog>

                {/* Static sidebar for desktop */}
                <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-72 lg:flex-col">
                    <div className="flex grow flex-col gap-y-5 overflow-y-auto border-r border-gray-200 bg-white px-6">
                        <div className="flex h-16 mt-6 shrink-0 items-center justify-center">
                            <img alt="ZipCase logo" src={ZipCaseLogo} className="h-8 w-auto" />
                        </div>
                        <nav className="flex flex-1 flex-col">
                            <ul role="list" className="flex flex-1 flex-col gap-y-7">
                                <li>
                                    <ul role="list" className="-mx-2 space-y-1">
                                        {navigation.map(item => (
                                            <li key={item.name}>
                                                <Link
                                                    to={item.href}
                                                    className={classNames(
                                                        item.current
                                                            ? 'bg-gray-50 text-primary'
                                                            : 'text-gray-700 hover:bg-gray-50 hover:text-primary',
                                                        'group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold focus:outline-none focus:ring-2 focus:ring-primary-dark'
                                                    )}
                                                >
                                                    <item.icon
                                                        aria-hidden="true"
                                                        className={classNames(
                                                            item.current
                                                                ? 'text-primary'
                                                                : 'text-gray-400 group-hover:text-primary',
                                                            'size-6 shrink-0'
                                                        )}
                                                    />
                                                    {item.name}
                                                </Link>
                                            </li>
                                        ))}
                                    </ul>
                                </li>
                            </ul>
                        </nav>
                    </div>

                    <div className="lg:fixed lg:bottom-0 lg:w-72 lg:px-6 lg:pb-6">
                        <button
                            onClick={handleSignOut}
                            className={classNames(
                                'bg-gray-50 text-gray-700 hover:bg-gray-50 hover:text-primary group flex gap-x-3 rounded-md p-2 text-sm/6 font-semibold focus:outline-none focus:ring-2 focus:ring-primary-dark w-full'
                            )}
                        >
                            <ArrowTopRightOnSquareIcon
                                aria-hidden="true"
                                className={classNames(
                                    'text-gray-400 group-hover:text-primary',
                                    'size-6 shrink-0'
                                )}
                            />
                            Sign out
                        </button>
                    </div>
                </div>

                <div className="sticky top-0 z-40 flex items-center gap-x-6 bg-white px-4 py-4 shadow-xs sm:px-6 lg:hidden">
                    <button
                        type="button"
                        onClick={() => setSidebarOpen(true)}
                        className="-m-2.5 p-2.5 text-gray-700 lg:hidden"
                    >
                        <span className="sr-only">Open sidebar</span>
                        <Bars3Icon aria-hidden="true" className="size-6" />
                    </button>
                </div>

                <main className="py-10 lg:pl-72">
                    <div className="px-4 sm:px-6 lg:px-8">
                        <Outlet />
                    </div>
                </main>
            </div>
        </>
    );
};

export default Shell;
