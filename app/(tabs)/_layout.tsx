import Feather from '@expo/vector-icons/Feather';
import { router, Tabs, usePathname } from "expo-router";
import { TouchableOpacity, View } from 'react-native';
export default function TabLayout() {
    const tabOrder: any = ["/", "/Browse", "/Track", "/Profile"];
    const pathname = usePathname();

    const currentIndex = tabOrder.indexOf(pathname);

    const handleBack = () => {
        if (currentIndex > 0) {
            router.replace(tabOrder[currentIndex - 1]);
        }
    };

    return (

        <Tabs
            screenOptions={
                {
                    tabBarActiveTintColor: "black",
                    tabBarInactiveTintColor: "gray",

                    tabBarLabelStyle: { fontSize: 12, textTransform: "capitalize" },
                    tabBarStyle: {
                        padding: 10,
                        height: 100,
                        alignItems: "center",
                        shadowColor: "green",
                        shadowOffset: {
                            width: 1, height: 4,
                        },
                        justifyContent: "center"


                    },
                    tabBarBackground: () => (
                        <View
                            style={{
                                flex: 1,
                                backgroundColor: "#ebebeb",
                            }}
                        />
                    ),
                    headerLeft: () =>
                        currentIndex > 0 ? (
                            <TouchableOpacity onPress={handleBack} style={{ marginLeft: 15 }}>
                                <Feather name="arrow-left" size={24} color="black" />
                            </TouchableOpacity>
                        ) : null,


                }

            }

        >



            <Tabs.Screen name="home" options={{ title: "Home" }} />
            <Tabs.Screen name="profile" options={{ title: "Profile" }} />
        </Tabs>




    );
}
