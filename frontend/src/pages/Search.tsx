import React from 'react';
import { SearchPanel, SearchResultsList } from '../components';
import NameSearchPanel from '../components/app/NameSearchPanel';

interface SearchProps {
    type?: 'case' | 'name';
}

const Search: React.FC<SearchProps> = ({ type = 'case' }) => {
    return (
        <>
            {type === 'case' ? <SearchPanel /> : <NameSearchPanel />}
            <SearchResultsList />
        </>
    );
};

export default Search;
