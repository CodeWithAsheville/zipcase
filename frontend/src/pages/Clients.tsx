import React from 'react';
import { Heading, Subheading, Text, TextLink } from '../components';

const Clients: React.FC = () => {
    return (
        <div className="max-w-3xl mx-auto space-y-8">
            <div>
                <Heading>Client Management</Heading>
                <Text className="mt-2">This feature is currently under consideration for future development.</Text>
            </div>

            <section className="p-6 bg-blue-50 rounded-lg border border-blue-100 space-y-4">
                <div className="flex items-center gap-3">
                    <Subheading>💡 Feature Preview</Subheading>
                </div>

                <Text>We're considering adding lightweight case management capabilities to ZipCase, allowing you to:</Text>

                <ul className="list-disc ml-6 space-y-2">
                    <li>Group case searches by client</li>
                    <li>Save and organize case information</li>
                    <li>Add notes to cases</li>
                    <li>Track case updates over time</li>
                </ul>

                <div className="pt-2">
                    <Text>
                        <strong>Is this something you'd find useful?</strong> We'd love to hear your thoughts!
                        <br />
                        Please email us at{' '}
                        <TextLink href="mailto:support@zipcase.org?subject=Client%20Management%20Feature">
                            support@zipcase.org
                        </TextLink>{' '}
                        with "Client Management Feature" in the subject line.
                    </Text>
                </div>
            </section>

            <section>
                <Text className="text-sm text-gray-500 italic">
                    Our development priorities are guided by user feedback. Features that receive significant interest from our user
                    community will be prioritized in our velopment roadmap.
                </Text>
            </section>
        </div>
    );
};

export default Clients;
